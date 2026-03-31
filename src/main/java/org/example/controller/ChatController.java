package org.example.controller;

import org.example.model.ChatMessage;
import org.example.model.ChatRoom;
import org.example.model.UserInfo;
import org.example.service.*;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Controller
public class ChatController {

    private final OnlineUserService onlineUserService;
    private final RoomService roomService;
    private final PollService pollService;
    private final CalendarService calendarService;
    private final RoomHistoryService roomHistoryService;
    private final RpsService rpsService;
    private final GachaService gachaService;
    private final SimpMessagingTemplate messagingTemplate;

    public ChatController(OnlineUserService onlineUserService, RoomService roomService,
                          PollService pollService, CalendarService calendarService,
                          RoomHistoryService roomHistoryService, RpsService rpsService,
                          GachaService gachaService,
                          SimpMessagingTemplate messagingTemplate) {
        this.onlineUserService = onlineUserService;
        this.roomService = roomService;
        this.pollService = pollService;
        this.calendarService = calendarService;
        this.roomHistoryService = roomHistoryService;
        this.rpsService = rpsService;
        this.gachaService = gachaService;
        this.messagingTemplate = messagingTemplate;
    }

    @GetMapping("/")
    public String index(Model model) {
        model.addAttribute("autoRoom", "");
        model.addAttribute("autoNickname", "");
        return "index";
    }

    private void broadcastRoomList() {
        List<ChatRoom> rooms = roomService.getAllRooms();
        for (ChatRoom room : rooms) {
            room.setUserCount(onlineUserService.getUsersInRoom(room.getRoomId()).size());
        }
        messagingTemplate.convertAndSend("/topic/rooms", rooms);
    }

    @GetMapping("/join")
    public String joinDirect(@RequestParam(value = "room", defaultValue = "") String room,
                             @RequestParam(value = "nickname", defaultValue = "") String nickname,
                             Model model) {
        model.addAttribute("autoRoom", room);
        model.addAttribute("autoNickname", nickname);
        return "index";
    }

    @MessageMapping("/chat.register")
    public void register(@Payload ChatMessage chatMessage, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        String ip = "unknown";
        if (headerAccessor.getSessionAttributes() != null) {
            String attrIp = (String) headerAccessor.getSessionAttributes().get("ip");
            if (attrIp != null) {
                ip = attrIp;
            }
            headerAccessor.getSessionAttributes().put("nickname", chatMessage.getSender());
        }
        onlineUserService.addUser(sessionId, ip, chatMessage.getSender());
        broadcastRoomList();
    }

    @MessageMapping("/chat.createTicketRoom")
    public void createTicketRoom(@Payload ChatMessage chatMessage, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        String nickname = user != null ? user.getNickname() : "unknown";

        try {
            ChatRoom room = roomService.createTicketRoom(chatMessage.getContent(), nickname);
            if (room != null) {
                broadcastRoomList();
                messagingTemplate.convertAndSendToUser(sessionId, "/queue/roomCreated", room,
                        createHeaders(sessionId));
            } else {
                sendError(sessionId, "此 Ticket 已有對應的討論區，請直接加入");
            }
        } catch (IllegalArgumentException e) {
            sendError(sessionId, e.getMessage());
        }
    }

    @MessageMapping("/chat.createGeneralRoom")
    public void createGeneralRoom(@Payload ChatMessage chatMessage, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        String nickname = user != null ? user.getNickname() : "unknown";

        try {
            ChatRoom room = roomService.createGeneralRoom(chatMessage.getContent(), nickname);
            broadcastRoomList();
            messagingTemplate.convertAndSendToUser(sessionId, "/queue/roomCreated", room,
                    createHeaders(sessionId));
        } catch (IllegalArgumentException e) {
            sendError(sessionId, e.getMessage());
        }
    }

    @MessageMapping("/chat.createGachaRoom")
    public void createGachaRoom(@Payload ChatMessage chatMessage, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        String nickname = user != null ? user.getNickname() : "unknown";

        try {
            ChatRoom room = roomService.createGachaRoom(chatMessage.getContent(), nickname);
            broadcastRoomList();
            messagingTemplate.convertAndSendToUser(sessionId, "/queue/roomCreated", room,
                    createHeaders(sessionId));
        } catch (IllegalArgumentException e) {
            sendError(sessionId, e.getMessage());
        }
    }

    private void sendError(String sessionId, String message) {
        ChatMessage error = new ChatMessage(ChatMessage.MessageType.CHAT, message, "系統");
        messagingTemplate.convertAndSendToUser(sessionId, "/queue/errors", error,
                createHeaders(sessionId));
    }

    @MessageMapping("/chat.joinRoom")
    public void joinRoom(@Payload ChatMessage chatMessage, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        String roomId = chatMessage.getRoomId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null || roomService.getRoom(roomId) == null) return;

        onlineUserService.assignRoom(sessionId, roomId);

        // Send accumulated history to this user BEFORE the join broadcast
        Map<String, Object> history = new LinkedHashMap<>();
        history.put("chatHistory", roomHistoryService.getChatHistory(roomId));
        history.put("polls", pollService.getPollsByRoom(roomId));
        history.put("calendar", calendarService.getEventsByRoom(roomId));
        history.put("lotteryHistory", roomHistoryService.getLotteryHistory(roomId));
        history.put("canvasHistory", roomHistoryService.getCanvasHistory(roomId));
        history.put("canvasSnapshots", roomHistoryService.getCanvasSnapshots(roomId));
        history.put("memos", roomHistoryService.getMemos(roomId));
        history.put("rpsRecords", rpsService.getRecordsForRoom(roomId));
        history.put("gacha", gachaService.getPoolsByRoom(roomId));
        messagingTemplate.convertAndSendToUser(sessionId, "/queue/roomHistory", history,
                createHeaders(sessionId));

        // Broadcast JOIN message to the room
        ChatMessage joinMsg = new ChatMessage(ChatMessage.MessageType.JOIN,
                user.getNickname() + " (" + user.getIp() + ") 已加入討論區", "系統", roomId);
        roomHistoryService.addChatMessage(roomId, joinMsg);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/messages", joinMsg);

        // Broadcast updated user list
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/users",
                onlineUserService.getUsersInRoom(roomId));
    }

    @MessageMapping("/chat.leaveRoom")
    public void leaveRoom(@Payload ChatMessage chatMessage, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        String roomId = chatMessage.getRoomId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        onlineUserService.clearRoom(sessionId);

        ChatMessage leaveMsg = new ChatMessage(ChatMessage.MessageType.LEAVE,
                user.getNickname() + " (" + user.getIp() + ") 已離開討論區", "系統", roomId);
        roomHistoryService.addChatMessage(roomId, leaveMsg);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/messages", leaveMsg);

        List<UserInfo> remaining = onlineUserService.getUsersInRoom(roomId);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/users", remaining);

        if (remaining.isEmpty()) {
            roomService.removeRoom(roomId);
            pollService.removePollsByRoom(roomId);
            calendarService.removeEventsByRoom(roomId);
            roomHistoryService.removeRoom(roomId);
            rpsService.removeByRoom(roomId);
            gachaService.removeByRoom(roomId);
        }

        broadcastRoomList();
    }

    @MessageMapping("/chat.sendMessage")
    public void sendMessage(@Payload ChatMessage chatMessage, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        String sender = chatMessage.getSender();
        if (user != null && !"互動".equals(sender) && !"系統".equals(sender)) {
            chatMessage.setSender(user.getNickname());
        }
        chatMessage.setType(ChatMessage.MessageType.CHAT);

        String roomId = chatMessage.getRoomId();
        if (roomId != null) {
            roomHistoryService.addChatMessage(roomId, chatMessage);
            messagingTemplate.convertAndSend("/topic/room/" + roomId + "/messages", chatMessage);
        }
    }

    private org.springframework.messaging.MessageHeaders createHeaders(String sessionId) {
        org.springframework.messaging.simp.SimpMessageHeaderAccessor accessor =
                org.springframework.messaging.simp.SimpMessageHeaderAccessor.create();
        accessor.setSessionId(sessionId);
        accessor.setLeaveMutable(true);
        return accessor.getMessageHeaders();
    }
}
