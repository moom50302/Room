package org.example.controller;

import org.example.model.ChatMessage;
import org.example.model.UserInfo;
import org.example.service.OnlineUserService;
import org.example.service.RoomHistoryService;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.*;

@Controller
public class FortuneController {

    private final OnlineUserService onlineUserService;
    private final RoomHistoryService roomHistoryService;
    private final SimpMessagingTemplate messagingTemplate;
    private final Random random = new Random();

    public FortuneController(OnlineUserService onlineUserService,
                             RoomHistoryService roomHistoryService,
                             SimpMessagingTemplate messagingTemplate) {
        this.onlineUserService = onlineUserService;
        this.roomHistoryService = roomHistoryService;
        this.messagingTemplate = messagingTemplate;
    }

    @MessageMapping("/fortune.draw")
    public void draw(@Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = payload.get("roomId");
        if (roomId == null) return;

        int fortuneIndex = random.nextInt(60);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("drawer", user.getNickname());
        result.put("fortuneIndex", fortuneIndex);
        result.put("roomId", roomId);

        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/fortune", result);
    }

    @MessageMapping("/fortune.notify")
    public void notifyResult(@Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = payload.get("roomId");
        String fortuneName = payload.get("fortuneName");
        String fortuneType = payload.get("fortuneType");
        if (roomId == null || fortuneName == null) return;

        String msg = "[運勢] " + user.getNickname() + " 抽到了 " + fortuneName + "（" + fortuneType + "）";
        ChatMessage notification = new ChatMessage(ChatMessage.MessageType.CHAT, msg, "系統", roomId);
        roomHistoryService.addChatMessage(roomId, notification);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/messages", notification);
    }
}
