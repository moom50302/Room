package org.example.controller;

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
public class CanvasController {

    private final OnlineUserService onlineUserService;
    private final RoomHistoryService roomHistoryService;
    private final SimpMessagingTemplate messagingTemplate;

    public CanvasController(OnlineUserService onlineUserService,
                            RoomHistoryService roomHistoryService,
                            SimpMessagingTemplate messagingTemplate) {
        this.onlineUserService = onlineUserService;
        this.roomHistoryService = roomHistoryService;
        this.messagingTemplate = messagingTemplate;
    }

    @MessageMapping("/canvas.draw")
    public void draw(@Payload Map<String, Object> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = (String) payload.get("roomId");
        if (roomId == null) return;

        payload.put("drawer", user.getNickname());
        roomHistoryService.addCanvasStroke(roomId, payload);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/canvas", payload);
    }

    @MessageMapping("/canvas.clear")
    public void clear(@Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = payload.get("roomId");
        if (roomId == null) return;

        roomHistoryService.clearCanvasHistory(roomId);

        Map<String, Object> clearMsg = new LinkedHashMap<>();
        clearMsg.put("type", "clear");
        clearMsg.put("clearedBy", user.getNickname());
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/canvas", clearMsg);
    }

    @MessageMapping("/canvas.saveSnapshot")
    public void saveSnapshot(@Payload Map<String, Object> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = (String) payload.get("roomId");
        String dataUrl = (String) payload.get("dataUrl");
        String time = (String) payload.get("time");
        if (roomId == null || dataUrl == null) return;

        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("dataUrl", dataUrl);
        snapshot.put("time", time != null ? time : "");
        snapshot.put("savedBy", user.getNickname());

        roomHistoryService.addCanvasSnapshot(roomId, snapshot);
        broadcastSnapshots(roomId);
    }

    @MessageMapping("/canvas.deleteSnapshot")
    public void deleteSnapshot(@Payload Map<String, Object> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = (String) payload.get("roomId");
        Object idxObj = payload.get("index");
        if (roomId == null || idxObj == null) return;

        int index = idxObj instanceof Number ? ((Number) idxObj).intValue() : Integer.parseInt(idxObj.toString());
        roomHistoryService.removeCanvasSnapshot(roomId, index);
        broadcastSnapshots(roomId);
    }

    private void broadcastSnapshots(String roomId) {
        List<Map<String, Object>> snapshots = roomHistoryService.getCanvasSnapshots(roomId);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/snapshots", snapshots);
    }
}
