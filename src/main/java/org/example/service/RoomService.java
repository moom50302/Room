package org.example.service;

import org.example.model.ChatRoom;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RoomService {

    private static final String REDMINE_BASE_URL = "https://redmine.ghtinc.com/issues/";

    private final Map<String, ChatRoom> rooms = new ConcurrentHashMap<>();

    public ChatRoom createTicketRoom(String ticketNumber, String creatorNickname) {
        if (ticketNumber == null || !ticketNumber.matches("\\d+")) {
            throw new IllegalArgumentException("請輸入有效的數字單號");
        }
        if (findByTicketNumber(ticketNumber) != null) {
            return null;
        }

        String ticketUrl = REDMINE_BASE_URL + ticketNumber;
        String roomId = UUID.randomUUID().toString().substring(0, 8);
        String roomName = "這是 Ticket #" + ticketNumber + " 的討論區";
        ChatRoom room = new ChatRoom(roomId, roomName, ChatRoom.RoomType.TICKET,
                ticketUrl, ticketNumber, creatorNickname);
        rooms.put(roomId, room);
        return room;
    }

    public ChatRoom createGeneralRoom(String roomName, String creatorNickname) {
        if (roomName == null || roomName.trim().isEmpty()) {
            throw new IllegalArgumentException("請輸入討論區名稱");
        }

        String roomId = UUID.randomUUID().toString().substring(0, 8);
        ChatRoom room = new ChatRoom(roomId, roomName.trim(), ChatRoom.RoomType.GENERAL,
                null, null, creatorNickname);
        rooms.put(roomId, room);
        return room;
    }

    public ChatRoom createGachaRoom(String roomName, String creatorNickname) {
        if (roomName == null || roomName.trim().isEmpty()) {
            throw new IllegalArgumentException("請輸入抽獎活動名稱");
        }

        String roomId = UUID.randomUUID().toString().substring(0, 8);
        ChatRoom room = new ChatRoom(roomId, roomName.trim(), ChatRoom.RoomType.GACHA,
                null, null, creatorNickname);
        rooms.put(roomId, room);
        return room;
    }

    public ChatRoom getRoom(String roomId) {
        return rooms.get(roomId);
    }

    public List<ChatRoom> getAllRooms() {
        return new ArrayList<>(rooms.values());
    }

    public void removeRoom(String roomId) {
        rooms.remove(roomId);
    }

    public ChatRoom findByTicketNumber(String ticketNumber) {
        for (ChatRoom room : rooms.values()) {
            if (ticketNumber.equals(room.getTicketNumber())) {
                return room;
            }
        }
        return null;
    }
}
