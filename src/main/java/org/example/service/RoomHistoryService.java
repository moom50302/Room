package org.example.service;

import org.example.model.ChatMessage;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RoomHistoryService {

    // Chat messages per room
    private final Map<String, List<ChatMessage>> chatHistory = new ConcurrentHashMap<>();

    // Lottery results per room
    private final Map<String, List<Map<String, Object>>> lotteryHistory = new ConcurrentHashMap<>();

    // Canvas strokes per room
    private final Map<String, List<Map<String, Object>>> canvasHistory = new ConcurrentHashMap<>();

    // ---- Chat ----

    public void addChatMessage(String roomId, ChatMessage message) {
        chatHistory.computeIfAbsent(roomId, k -> Collections.synchronizedList(new ArrayList<>()))
                .add(message);
    }

    public List<ChatMessage> getChatHistory(String roomId) {
        List<ChatMessage> list = chatHistory.get(roomId);
        return list != null ? new ArrayList<>(list) : Collections.<ChatMessage>emptyList();
    }

    // ---- Lottery ----

    public void addLotteryResult(String roomId, Map<String, Object> result) {
        lotteryHistory.computeIfAbsent(roomId, k -> Collections.synchronizedList(new ArrayList<>()))
                .add(result);
    }

    public List<Map<String, Object>> getLotteryHistory(String roomId) {
        List<Map<String, Object>> list = lotteryHistory.get(roomId);
        return list != null ? new ArrayList<>(list) : Collections.<Map<String, Object>>emptyList();
    }

    // ---- Canvas ----

    public void addCanvasStroke(String roomId, Map<String, Object> stroke) {
        canvasHistory.computeIfAbsent(roomId, k -> Collections.synchronizedList(new ArrayList<>()))
                .add(stroke);
    }

    public void clearCanvasHistory(String roomId) {
        List<Map<String, Object>> list = canvasHistory.get(roomId);
        if (list != null) {
            list.clear();
        }
    }

    public List<Map<String, Object>> getCanvasHistory(String roomId) {
        List<Map<String, Object>> list = canvasHistory.get(roomId);
        return list != null ? new ArrayList<>(list) : Collections.<Map<String, Object>>emptyList();
    }

    // ---- Canvas Snapshots ----

    private final Map<String, List<Map<String, Object>>> canvasSnapshots = new ConcurrentHashMap<>();

    public void addCanvasSnapshot(String roomId, Map<String, Object> snapshot) {
        canvasSnapshots.computeIfAbsent(roomId, k -> Collections.synchronizedList(new ArrayList<>()))
                .add(snapshot);
    }

    public void removeCanvasSnapshot(String roomId, int index) {
        List<Map<String, Object>> list = canvasSnapshots.get(roomId);
        if (list != null && index >= 0 && index < list.size()) {
            list.remove(index);
        }
    }

    public List<Map<String, Object>> getCanvasSnapshots(String roomId) {
        List<Map<String, Object>> list = canvasSnapshots.get(roomId);
        return list != null ? new ArrayList<>(list) : Collections.<Map<String, Object>>emptyList();
    }

    // ---- Memos ----

    private final Map<String, List<Map<String, Object>>> memos = new ConcurrentHashMap<>();

    public void addMemo(String roomId, Map<String, Object> memo) {
        memos.computeIfAbsent(roomId, k -> Collections.synchronizedList(new ArrayList<>()))
                .add(memo);
    }

    public void removeMemo(String roomId, int index) {
        List<Map<String, Object>> list = memos.get(roomId);
        if (list != null && index >= 0 && index < list.size()) {
            list.remove(index);
        }
    }

    public List<Map<String, Object>> getMemos(String roomId) {
        List<Map<String, Object>> list = memos.get(roomId);
        return list != null ? new ArrayList<>(list) : Collections.<Map<String, Object>>emptyList();
    }

    // ---- Cleanup ----

    public void removeRoom(String roomId) {
        chatHistory.remove(roomId);
        lotteryHistory.remove(roomId);
        canvasHistory.remove(roomId);
        canvasSnapshots.remove(roomId);
        memos.remove(roomId);
    }
}
