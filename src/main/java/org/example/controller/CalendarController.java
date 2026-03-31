package org.example.controller;

import org.example.model.CalendarEvent;
import org.example.model.ChatMessage;
import org.example.model.UserInfo;
import org.example.service.CalendarService;
import org.example.service.OnlineUserService;
import org.example.service.RoomHistoryService;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.Map;

@Controller
public class CalendarController {

    private final CalendarService calendarService;
    private final OnlineUserService onlineUserService;
    private final RoomHistoryService roomHistoryService;
    private final SimpMessagingTemplate messagingTemplate;

    public CalendarController(CalendarService calendarService, OnlineUserService onlineUserService,
                              RoomHistoryService roomHistoryService,
                              SimpMessagingTemplate messagingTemplate) {
        this.calendarService = calendarService;
        this.onlineUserService = onlineUserService;
        this.roomHistoryService = roomHistoryService;
        this.messagingTemplate = messagingTemplate;
    }

    @MessageMapping("/calendar.add")
    public void addEvent(@Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = payload.get("roomId");
        String title = payload.get("title");
        String date = payload.get("date");
        String time = payload.get("time");
        if (roomId == null || title == null || date == null) return;

        CalendarEvent event = calendarService.addEvent(roomId, title.trim(), date, time, user.getNickname());

        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/calendar",
                calendarService.getEventsByRoom(roomId));

        String timeStr = (time != null && !time.isEmpty()) ? " " + time : "";
        sendChatNotification(roomId, "[行事曆] " + user.getNickname() + " 新增了事件: " + title.trim() + " (" + date + timeStr + ")");
    }

    @MessageMapping("/calendar.remove")
    public void removeEvent(@Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);

        String roomId = payload.get("roomId");
        String eventId = payload.get("eventId");
        if (roomId == null || eventId == null) return;

        calendarService.removeEvent(eventId);

        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/calendar",
                calendarService.getEventsByRoom(roomId));

        String who = (user != null) ? user.getNickname() : "某人";
        sendChatNotification(roomId, "[行事曆] " + who + " 刪除了一個事件");
    }

    private void sendChatNotification(String roomId, String content) {
        ChatMessage notification = new ChatMessage(ChatMessage.MessageType.CHAT, content, "系統", roomId);
        roomHistoryService.addChatMessage(roomId, notification);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/messages", notification);
    }
}
