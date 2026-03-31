package org.example.model;

public class UserInfo {
    private String ip;
    private String nickname;
    private String roomId;

    public UserInfo() {
    }

    public UserInfo(String ip, String nickname) {
        this.ip = ip;
        this.nickname = nickname;
    }

    public String getIp() {
        return ip;
    }

    public void setIp(String ip) {
        this.ip = ip;
    }

    public String getNickname() {
        return nickname;
    }

    public void setNickname(String nickname) {
        this.nickname = nickname;
    }

    public String getRoomId() {
        return roomId;
    }

    public void setRoomId(String roomId) {
        this.roomId = roomId;
    }
}
