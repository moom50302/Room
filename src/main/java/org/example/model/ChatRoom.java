package org.example.model;

public class ChatRoom {

    public enum RoomType {
        TICKET, GENERAL, GACHA
    }

    private String roomId;
    private String roomName;
    private RoomType roomType;
    private String ticketUrl;
    private String ticketNumber;
    private String creatorNickname;
    private int userCount;

    public ChatRoom() {
    }

    public ChatRoom(String roomId, String roomName, RoomType roomType, String ticketUrl,
                    String ticketNumber, String creatorNickname) {
        this.roomId = roomId;
        this.roomName = roomName;
        this.roomType = roomType;
        this.ticketUrl = ticketUrl;
        this.ticketNumber = ticketNumber;
        this.creatorNickname = creatorNickname;
    }

    public String getRoomId() {
        return roomId;
    }

    public void setRoomId(String roomId) {
        this.roomId = roomId;
    }

    public String getRoomName() {
        return roomName;
    }

    public void setRoomName(String roomName) {
        this.roomName = roomName;
    }

    public RoomType getRoomType() {
        return roomType;
    }

    public void setRoomType(RoomType roomType) {
        this.roomType = roomType;
    }

    public String getTicketUrl() {
        return ticketUrl;
    }

    public void setTicketUrl(String ticketUrl) {
        this.ticketUrl = ticketUrl;
    }

    public String getTicketNumber() {
        return ticketNumber;
    }

    public void setTicketNumber(String ticketNumber) {
        this.ticketNumber = ticketNumber;
    }

    public String getCreatorNickname() {
        return creatorNickname;
    }

    public void setCreatorNickname(String creatorNickname) {
        this.creatorNickname = creatorNickname;
    }

    public int getUserCount() {
        return userCount;
    }

    public void setUserCount(int userCount) {
        this.userCount = userCount;
    }
}
