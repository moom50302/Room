package org.example.model;

import java.util.List;
import java.util.Map;
import java.util.Set;

public class Poll {
    private String pollId;
    private String roomId;
    private String question;
    private List<String> options;
    private Map<String, Integer> votes;       // option -> vote count
    private Set<String> votedUsers;           // nicknames who already voted
    private String creator;

    public Poll() {
    }

    public Poll(String pollId, String roomId, String question, List<String> options,
                Map<String, Integer> votes, Set<String> votedUsers, String creator) {
        this.pollId = pollId;
        this.roomId = roomId;
        this.question = question;
        this.options = options;
        this.votes = votes;
        this.votedUsers = votedUsers;
        this.creator = creator;
    }

    public String getPollId() {
        return pollId;
    }

    public void setPollId(String pollId) {
        this.pollId = pollId;
    }

    public String getRoomId() {
        return roomId;
    }

    public void setRoomId(String roomId) {
        this.roomId = roomId;
    }

    public String getQuestion() {
        return question;
    }

    public void setQuestion(String question) {
        this.question = question;
    }

    public List<String> getOptions() {
        return options;
    }

    public void setOptions(List<String> options) {
        this.options = options;
    }

    public Map<String, Integer> getVotes() {
        return votes;
    }

    public void setVotes(Map<String, Integer> votes) {
        this.votes = votes;
    }

    public Set<String> getVotedUsers() {
        return votedUsers;
    }

    public void setVotedUsers(Set<String> votedUsers) {
        this.votedUsers = votedUsers;
    }

    public String getCreator() {
        return creator;
    }

    public void setCreator(String creator) {
        this.creator = creator;
    }
}
