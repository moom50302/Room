package org.example.service;

import org.example.model.UserInfo;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class OnlineUserService {

    // sessionId -> UserInfo
    private final Map<String, UserInfo> onlineUsers = new ConcurrentHashMap<>();

    public void addUser(String sessionId, String ip, String nickname) {
        onlineUsers.put(sessionId, new UserInfo(ip, nickname));
    }

    public UserInfo removeUser(String sessionId) {
        return onlineUsers.remove(sessionId);
    }

    public UserInfo getUser(String sessionId) {
        return onlineUsers.get(sessionId);
    }

    public List<UserInfo> getAllUsers() {
        return new ArrayList<>(onlineUsers.values());
    }

    public void assignRoom(String sessionId, String roomId) {
        UserInfo user = onlineUsers.get(sessionId);
        if (user != null) {
            user.setRoomId(roomId);
        }
    }

    public void clearRoom(String sessionId) {
        UserInfo user = onlineUsers.get(sessionId);
        if (user != null) {
            user.setRoomId(null);
        }
    }

    public List<UserInfo> getUsersInRoom(String roomId) {
        List<UserInfo> result = new ArrayList<>();
        for (UserInfo user : onlineUsers.values()) {
            if (roomId.equals(user.getRoomId())) {
                result.add(user);
            }
        }
        return result;
    }

    public String findSessionByNickname(String nickname) {
        for (Map.Entry<String, UserInfo> entry : onlineUsers.entrySet()) {
            if (entry.getValue().getNickname().equals(nickname)) {
                return entry.getKey();
            }
        }
        return null;
    }
}
