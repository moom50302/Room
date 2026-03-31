package org.example.controller;

import org.example.model.ChatMessage;
import org.example.model.UserInfo;
import org.example.service.OnlineUserService;
import org.example.service.RoomHistoryService;
import org.example.service.RpsService;
import org.springframework.messaging.MessageHeaders;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.LinkedHashMap;
import java.util.Map;

@Controller
public class RpsController {

    private final OnlineUserService onlineUserService;
    private final RpsService rpsService;
    private final RoomHistoryService roomHistoryService;
    private final SimpMessagingTemplate messagingTemplate;

    public RpsController(OnlineUserService onlineUserService,
                         RpsService rpsService,
                         RoomHistoryService roomHistoryService,
                         SimpMessagingTemplate messagingTemplate) {
        this.onlineUserService = onlineUserService;
        this.rpsService = rpsService;
        this.roomHistoryService = roomHistoryService;
        this.messagingTemplate = messagingTemplate;
    }

    @MessageMapping("/rps.challenge")
    public void challenge(@Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = payload.get("roomId");
        String target = payload.get("target");
        String choice = payload.get("choice");
        if (roomId == null || target == null || choice == null) return;

        // Create game
        Map<String, String> game = rpsService.createGame(roomId, user.getNickname(), target, choice);

        // Notify target user
        String targetSessionId = onlineUserService.findSessionByNickname(target);
        if (targetSessionId == null) return;

        Map<String, String> challengeNotification = new LinkedHashMap<>();
        challengeNotification.put("gameId", game.get("gameId"));
        challengeNotification.put("challenger", user.getNickname());
        messagingTemplate.convertAndSendToUser(targetSessionId, "/queue/rpsChallenge",
                challengeNotification, createHeaders(targetSessionId));

        // System message in chat
        ChatMessage notification = new ChatMessage(ChatMessage.MessageType.CHAT,
                "🎮 [猜拳] " + user.getNickname() + " 向 " + target + " 發起了猜拳挑戰！",
                "系統", roomId);
        roomHistoryService.addChatMessage(roomId, notification);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/messages", notification);
    }

    @MessageMapping("/rps.respond")
    public void respond(@Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String gameId = payload.get("gameId");
        String choice = payload.get("choice");
        if (gameId == null || choice == null) return;

        // Verify it's the correct target
        Map<String, String> game = rpsService.getGame(gameId);
        if (game == null || !user.getNickname().equals(game.get("target"))) return;

        Map<String, Object> result = rpsService.resolveGame(gameId, choice);
        if (result == null) return;

        String roomId = (String) result.get("roomId");

        // Send result to chat
        ChatMessage resultMsg = new ChatMessage(ChatMessage.MessageType.CHAT,
                (String) result.get("resultText"), "系統", roomId);
        roomHistoryService.addChatMessage(roomId, resultMsg);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/messages", resultMsg);

        // Broadcast updated records
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/rpsRecords", result.get("records"));
    }

    private MessageHeaders createHeaders(String sessionId) {
        SimpMessageHeaderAccessor accessor = SimpMessageHeaderAccessor.create();
        accessor.setSessionId(sessionId);
        accessor.setLeaveMutable(true);
        return accessor.getMessageHeaders();
    }
}
