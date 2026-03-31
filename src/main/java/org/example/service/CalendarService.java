package org.example.service;

import org.example.model.CalendarEvent;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class CalendarService {

    private final Map<String, CalendarEvent> events = new ConcurrentHashMap<>();

    public CalendarEvent addEvent(String roomId, String title, String date, String time, String creator) {
        String eventId = UUID.randomUUID().toString().substring(0, 8);
        CalendarEvent event = new CalendarEvent(eventId, roomId, title, date, time, creator);
        events.put(eventId, event);
        return event;
    }

    public void removeEvent(String eventId) {
        events.remove(eventId);
    }

    public List<CalendarEvent> getEventsByRoom(String roomId) {
        return events.values().stream()
                .filter(e -> e.getRoomId().equals(roomId))
                .sorted(Comparator.comparing(CalendarEvent::getDate)
                        .thenComparing(e -> e.getTime() != null ? e.getTime() : ""))
                .collect(Collectors.toList());
    }

    public void removeEventsByRoom(String roomId) {
        events.entrySet().removeIf(e -> e.getValue().getRoomId().equals(roomId));
    }
}
