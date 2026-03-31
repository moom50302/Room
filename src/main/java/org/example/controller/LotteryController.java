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
public class LotteryController {

    private final OnlineUserService onlineUserService;
    private final RoomHistoryService roomHistoryService;
    private final SimpMessagingTemplate messagingTemplate;
    private final Random random = new Random();

    public LotteryController(OnlineUserService onlineUserService,
                             RoomHistoryService roomHistoryService,
                             SimpMessagingTemplate messagingTemplate) {
        this.onlineUserService = onlineUserService;
        this.roomHistoryService = roomHistoryService;
        this.messagingTemplate = messagingTemplate;
    }

    @MessageMapping("/lottery.draw")
    public void draw(@Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = payload.get("roomId");
        String optionsStr = payload.get("options");
        if (roomId == null || optionsStr == null) return;

        List<String> options = new ArrayList<>();
        for (String opt : optionsStr.split(",")) {
            String trimmed = opt.trim();
            if (!trimmed.isEmpty()) {
                options.add(trimmed);
            }
        }
        if (options.size() < 2) return;

        int resultIndex = random.nextInt(options.size());
        String result = options.get(resultIndex);

        Map<String, Object> lotteryResult = new LinkedHashMap<>();
        lotteryResult.put("drawer", user.getNickname());
        lotteryResult.put("options", options);
        lotteryResult.put("result", result);
        lotteryResult.put("resultIndex", resultIndex);
        lotteryResult.put("animate", true);

        roomHistoryService.addLotteryResult(roomId, lotteryResult);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/lottery", lotteryResult);
    }

    @MessageMapping("/lottery.notify")
    public void notifyResult(@Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = payload.get("roomId");
        String result = payload.get("result");
        if (roomId == null || result == null) return;

        ChatMessage notification = new ChatMessage(ChatMessage.MessageType.CHAT,
                "[樂透選] " + user.getNickname() + " 抽到了: " + result, "系統", roomId);
        roomHistoryService.addChatMessage(roomId, notification);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/messages", notification);
    }
}
