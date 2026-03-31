package org.example.config;

import org.example.model.ChatMessage;
import org.example.model.ChatRoom;
import org.example.model.UserInfo;
import org.example.service.*;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.List;

@Component
public class WebSocketEventListener {

    private final SimpMessagingTemplate messagingTemplate;
    private final OnlineUserService onlineUserService;
    private final RoomService roomService;
    private final PollService pollService;
    private final CalendarService calendarService;
    private final RoomHistoryService roomHistoryService;
    private final RpsService rpsService;
    private final GachaService gachaService;

    public WebSocketEventListener(SimpMessagingTemplate messagingTemplate,
                                  OnlineUserService onlineUserService,
                                  RoomService roomService,
                                  PollService pollService,
                                  CalendarService calendarService,
                                  RoomHistoryService roomHistoryService,
                                  RpsService rpsService,
                                  GachaService gachaService) {
        this.messagingTemplate = messagingTemplate;
        this.onlineUserService = onlineUserService;
        this.roomService = roomService;
        this.pollService = pollService;
        this.calendarService = calendarService;
        this.roomHistoryService = roomHistoryService;
        this.rpsService = rpsService;
        this.gachaService = gachaService;
    }

    @EventListener
    public void handleWebSocketDisconnectListener(SessionDisconnectEvent event) {
        SimpMessageHeaderAccessor headerAccessor = SimpMessageHeaderAccessor.wrap(event.getMessage());
        String sessionId = headerAccessor.getSessionId();

        UserInfo user = onlineUserService.getUser(sessionId);
        if (user != null) {
            String roomId = user.getRoomId();

            if (roomId != null) {
                ChatMessage leaveMessage = new ChatMessage(
                        ChatMessage.MessageType.LEAVE,
                        user.getNickname() + " (" + user.getIp() + ") 已離開討論區",
                        "系統", roomId);
                roomHistoryService.addChatMessage(roomId, leaveMessage);
                messagingTemplate.convertAndSend("/topic/room/" + roomId + "/messages", leaveMessage);

                onlineUserService.removeUser(sessionId);

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
            } else {
                onlineUserService.removeUser(sessionId);
            }
        }
    }

    private void broadcastRoomList() {
        java.util.List<ChatRoom> rooms = roomService.getAllRooms();
        for (ChatRoom room : rooms) {
            room.setUserCount(onlineUserService.getUsersInRoom(room.getRoomId()).size());
        }
        messagingTemplate.convertAndSend("/topic/rooms", rooms);
    }
}
