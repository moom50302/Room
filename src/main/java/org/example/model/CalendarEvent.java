package org.example.model;

public class CalendarEvent {
    private String eventId;
    private String roomId;
    private String title;
    private String date;       // yyyy-MM-dd
    private String time;       // HH:mm (optional)
    private String creator;

    public CalendarEvent() {
    }

    public CalendarEvent(String eventId, String roomId, String title, String date,
                         String time, String creator) {
        this.eventId = eventId;
        this.roomId = roomId;
        this.title = title;
        this.date = date;
        this.time = time;
        this.creator = creator;
    }

    public String getEventId() {
        return eventId;
    }

    public void setEventId(String eventId) {
        this.eventId = eventId;
    }

    public String getRoomId() {
        return roomId;
    }

    public void setRoomId(String roomId) {
        this.roomId = roomId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDate() {
        return date;
    }

    public void setDate(String date) {
        this.date = date;
    }

    public String getTime() {
        return time;
    }

    public void setTime(String time) {
        this.time = time;
    }

    public String getCreator() {
        return creator;
    }

    public void setCreator(String creator) {
        this.creator = creator;
    }
}
