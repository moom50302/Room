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

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Controller
public class MemoController {

    private final OnlineUserService onlineUserService;
    private final RoomHistoryService roomHistoryService;
    private final SimpMessagingTemplate messagingTemplate;

    public MemoController(OnlineUserService onlineUserService,
                          RoomHistoryService roomHistoryService,
                          SimpMessagingTemplate messagingTemplate) {
        this.onlineUserService = onlineUserService;
        this.roomHistoryService = roomHistoryService;
        this.messagingTemplate = messagingTemplate;
    }

    @MessageMapping("/memo.save")
    public void save(@Payload Map<String, Object> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = (String) payload.get("roomId");
        String text = (String) payload.get("text");
        String time = (String) payload.get("time");
        if (roomId == null || text == null || text.trim().isEmpty()) return;

        Map<String, Object> memo = new LinkedHashMap<>();
        memo.put("text", text);
        memo.put("time", time != null ? time : "");
        memo.put("author", user.getNickname());

        roomHistoryService.addMemo(roomId, memo);
        broadcastMemos(roomId);

        // Send system message
        ChatMessage notification = new ChatMessage(ChatMessage.MessageType.CHAT,
                user.getNickname() + " 紀錄了一個 Memo", "系統", roomId);
        roomHistoryService.addChatMessage(roomId, notification);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/messages", notification);
    }

    @MessageMapping("/memo.delete")
    public void delete(@Payload Map<String, Object> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = (String) payload.get("roomId");
        Object idxObj = payload.get("index");
        if (roomId == null || idxObj == null) return;

        int index = idxObj instanceof Number ? ((Number) idxObj).intValue() : Integer.parseInt(idxObj.toString());
        roomHistoryService.removeMemo(roomId, index);
        broadcastMemos(roomId);
    }

    private void broadcastMemos(String roomId) {
        List<Map<String, Object>> memoList = roomHistoryService.getMemos(roomId);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/memos", memoList);
    }
}
