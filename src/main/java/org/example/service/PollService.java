package org.example.service;

import org.example.model.Poll;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class PollService {

    private final Map<String, Poll> polls = new ConcurrentHashMap<>();

    public Poll createPoll(String roomId, String question, List<String> options, String creator) {
        String pollId = UUID.randomUUID().toString().substring(0, 8);
        Map<String, Integer> votes = new LinkedHashMap<>();
        for (String option : options) {
            votes.put(option, 0);
        }
        Poll poll = new Poll(pollId, roomId, question, options, votes,
                ConcurrentHashMap.newKeySet(), creator);
        polls.put(pollId, poll);
        return poll;
    }

    public Poll vote(String pollId, String option, String nickname) {
        Poll poll = polls.get(pollId);
        if (poll == null) return null;
        if (poll.getVotedUsers().contains(nickname)) return null;
        if (!poll.getVotes().containsKey(option)) return null;

        poll.getVotes().put(option, poll.getVotes().get(option) + 1);
        poll.getVotedUsers().add(nickname);
        return poll;
    }

    public List<Poll> getPollsByRoom(String roomId) {
        return polls.values().stream()
                .filter(p -> p.getRoomId().equals(roomId))
                .collect(Collectors.toList());
    }

    public void removePollsByRoom(String roomId) {
        polls.entrySet().removeIf(e -> e.getValue().getRoomId().equals(roomId));
    }
}
