package org.example.controller;

import org.example.model.ChatMessage;
import org.example.model.UserInfo;
import org.example.service.GachaService;
import org.example.service.OnlineUserService;
import org.example.service.RoomHistoryService;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.*;

@Controller
public class GachaController {

    private final GachaService gachaService;
    private final OnlineUserService onlineUserService;
    private final RoomHistoryService roomHistoryService;
    private final SimpMessagingTemplate messagingTemplate;

    public GachaController(GachaService gachaService, OnlineUserService onlineUserService,
                           RoomHistoryService roomHistoryService,
                           SimpMessagingTemplate messagingTemplate) {
        this.gachaService = gachaService;
        this.onlineUserService = onlineUserService;
        this.roomHistoryService = roomHistoryService;
        this.messagingTemplate = messagingTemplate;
    }

    @SuppressWarnings("unchecked")
    @MessageMapping("/gacha.create")
    public void createPool(@Payload Map<String, Object> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = (String) payload.get("roomId");
        String poolName = (String) payload.get("poolName");
        Object maxDrawObj = payload.get("maxDrawPerIp");
        int maxDrawPerIp = maxDrawObj instanceof Number ? ((Number) maxDrawObj).intValue() : 0;
        List<Map<String, Object>> prizesRaw = (List<Map<String, Object>>) payload.get("prizes");

        if (roomId == null || poolName == null || prizesRaw == null || prizesRaw.isEmpty()) return;

        List<GachaService.Prize> prizes = new ArrayList<>();
        for (Map<String, Object> pr : prizesRaw) {
            String name = (String) pr.get("name");
            Object qtyObj = pr.get("qty");
            int qty = qtyObj instanceof Number ? ((Number) qtyObj).intValue() : 1;
            if (name != null && !name.trim().isEmpty() && qty > 0) {
                prizes.add(new GachaService.Prize(name.trim(), qty));
            }
        }
        if (prizes.isEmpty()) return;

        gachaService.createPool(roomId, poolName.trim(), user.getNickname(), maxDrawPerIp, prizes);
        broadcastPools(roomId);

        // Notify chat
        String msg = "[抽賞] " + user.getNickname() + " 建立了抽賞「" + poolName.trim() + "」";
        ChatMessage notification = new ChatMessage(ChatMessage.MessageType.CHAT, msg, "系統", roomId);
        roomHistoryService.addChatMessage(roomId, notification);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/messages", notification);
    }

    @MessageMapping("/gacha.draw")
    public void draw(@Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = payload.get("roomId");
        String poolId = payload.get("poolId");
        if (roomId == null || poolId == null) return;

        Map<String, Object> result = gachaService.draw(roomId, poolId, user.getIp(), user.getNickname());

        if (Boolean.TRUE.equals(result.get("success"))) {
            // Broadcast result for animation
            messagingTemplate.convertAndSend("/topic/room/" + roomId + "/gachaResult", result);
            // Also broadcast updated pool list
            broadcastPools(roomId);
        } else {
            // Send error to user only
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("content", result.get("error"));
            messagingTemplate.convertAndSendToUser(sessionId, "/queue/errors", error,
                    createHeaders(sessionId));
        }
    }

    @MessageMapping("/gacha.notify")
    public void notifyResult(@Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = payload.get("roomId");
        String poolName = payload.get("poolName");
        String prizeName = payload.get("prizeName");
        if (roomId == null || poolName == null || prizeName == null) return;

        String msg = "[抽賞] " + user.getNickname() + " 在「" + poolName + "」中抽到了「" + prizeName + "」！";
        ChatMessage notification = new ChatMessage(ChatMessage.MessageType.CHAT, msg, "系統", roomId);
        roomHistoryService.addChatMessage(roomId, notification);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/messages", notification);
    }

    @MessageMapping("/gacha.delete")
    public void deletePool(@Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = payload.get("roomId");
        String poolId = payload.get("poolId");
        if (roomId == null || poolId == null) return;

        boolean deleted = gachaService.deletePool(roomId, poolId, user.getNickname());
        if (deleted) {
            broadcastPools(roomId);
        }
    }

    private void broadcastPools(String roomId) {
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/gacha",
                gachaService.getPoolsByRoom(roomId));
    }

    private org.springframework.messaging.MessageHeaders createHeaders(String sessionId) {
        org.springframework.messaging.simp.SimpMessageHeaderAccessor accessor =
                org.springframework.messaging.simp.SimpMessageHeaderAccessor.create();
        accessor.setSessionId(sessionId);
        accessor.setLeaveMutable(true);
        return accessor.getMessageHeaders();
    }
}
