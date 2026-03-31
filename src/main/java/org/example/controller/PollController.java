package org.example.controller;

import org.example.model.ChatMessage;
import org.example.model.Poll;
import org.example.model.UserInfo;
import org.example.service.OnlineUserService;
import org.example.service.PollService;
import org.example.service.RoomHistoryService;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

@Controller
public class PollController {

    private final PollService pollService;
    private final OnlineUserService onlineUserService;
    private final RoomHistoryService roomHistoryService;
    private final SimpMessagingTemplate messagingTemplate;

    public PollController(PollService pollService, OnlineUserService onlineUserService,
                          RoomHistoryService roomHistoryService,
                          SimpMessagingTemplate messagingTemplate) {
        this.pollService = pollService;
        this.onlineUserService = onlineUserService;
        this.roomHistoryService = roomHistoryService;
        this.messagingTemplate = messagingTemplate;
    }

    @MessageMapping("/poll.create")
    public void createPoll(@Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = payload.get("roomId");
        String question = payload.get("question");
        String optionsStr = payload.get("options");
        if (roomId == null || question == null || optionsStr == null) return;

        List<String> options = Arrays.asList(optionsStr.split(","));
        pollService.createPoll(roomId, question.trim(), options, user.getNickname());

        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/polls",
                pollService.getPollsByRoom(roomId));

        // Notify chat
        sendChatNotification(roomId, "[投票] " + user.getNickname() + " 發起了投票: " + question.trim());
    }

    @MessageMapping("/poll.vote")
    public void vote(@Payload Map<String, String> payload, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        UserInfo user = onlineUserService.getUser(sessionId);
        if (user == null) return;

        String roomId = payload.get("roomId");
        String pollId = payload.get("pollId");
        String option = payload.get("option");
        if (roomId == null || pollId == null || option == null) return;

        Poll updated = pollService.vote(pollId, option, user.getNickname());
        if (updated != null) {
            messagingTemplate.convertAndSend("/topic/room/" + roomId + "/polls",
                    pollService.getPollsByRoom(roomId));

            sendChatNotification(roomId, "[投票] " + user.getNickname() + " 在「" + updated.getQuestion() + "」中投了一票");
        }
    }

    private void sendChatNotification(String roomId, String content) {
        ChatMessage notification = new ChatMessage(ChatMessage.MessageType.CHAT, content, "系統", roomId);
        roomHistoryService.addChatMessage(roomId, notification);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/messages", notification);
    }
}
