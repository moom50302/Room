package org.example.service;

import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RpsService {

    // gameId -> game data {gameId, roomId, challenger, target, challengerChoice, targetChoice, result}
    private final Map<String, Map<String, String>> activeGames = new ConcurrentHashMap<>();

    // roomId -> (nickname -> [wins, losses, draws])
    private final Map<String, Map<String, int[]>> records = new ConcurrentHashMap<>();

    private static final Map<String, String> CHOICE_NAMES = new LinkedHashMap<>();
    static {
        CHOICE_NAMES.put("scissors", "✌️剪刀");
        CHOICE_NAMES.put("rock", "✊石頭");
        CHOICE_NAMES.put("paper", "✋布");
    }

    public Map<String, String> createGame(String roomId, String challenger, String target, String challengerChoice) {
        String gameId = UUID.randomUUID().toString().substring(0, 8);
        Map<String, String> game = new LinkedHashMap<>();
        game.put("gameId", gameId);
        game.put("roomId", roomId);
        game.put("challenger", challenger);
        game.put("target", target);
        game.put("challengerChoice", challengerChoice);
        activeGames.put(gameId, game);
        return game;
    }

    public Map<String, String> getGame(String gameId) {
        return activeGames.get(gameId);
    }

    public Map<String, Object> resolveGame(String gameId, String targetChoice) {
        Map<String, String> game = activeGames.remove(gameId);
        if (game == null) return null;

        String challengerChoice = game.get("challengerChoice");
        String roomId = game.get("roomId");
        String challenger = game.get("challenger");
        String target = game.get("target");

        String result = calculate(challengerChoice, targetChoice);

        // Update records
        Map<String, int[]> roomRecords = records.computeIfAbsent(roomId, k -> new ConcurrentHashMap<>());
        int[] cRec = roomRecords.computeIfAbsent(challenger, k -> new int[3]);
        int[] tRec = roomRecords.computeIfAbsent(target, k -> new int[3]);

        String winnerText;
        if ("draw".equals(result)) {
            cRec[2]++;
            tRec[2]++;
            winnerText = "平手！";
        } else if ("challenger".equals(result)) {
            cRec[0]++;
            tRec[1]++;
            winnerText = challenger + " 獲勝！";
        } else {
            cRec[1]++;
            tRec[0]++;
            winnerText = target + " 獲勝！";
        }

        String cName = CHOICE_NAMES.getOrDefault(challengerChoice, challengerChoice);
        String tName = CHOICE_NAMES.getOrDefault(targetChoice, targetChoice);

        Map<String, Object> resolved = new LinkedHashMap<>();
        resolved.put("roomId", roomId);
        resolved.put("challenger", challenger);
        resolved.put("target", target);
        resolved.put("challengerChoice", cName);
        resolved.put("targetChoice", tName);
        resolved.put("resultText", "🎮 [猜拳] " + challenger + "(" + cName + ") vs " + target + "(" + tName + ") — " + winnerText);
        resolved.put("records", getRecordsForRoom(roomId));
        return resolved;
    }

    private String calculate(String a, String b) {
        if (a.equals(b)) return "draw";
        if (("scissors".equals(a) && "paper".equals(b)) ||
            ("rock".equals(a) && "scissors".equals(b)) ||
            ("paper".equals(a) && "rock".equals(b))) {
            return "challenger";
        }
        return "target";
    }

    public Map<String, Map<String, Integer>> getRecordsForRoom(String roomId) {
        Map<String, int[]> roomRecords = records.get(roomId);
        if (roomRecords == null) return Collections.emptyMap();

        Map<String, Map<String, Integer>> result = new LinkedHashMap<>();
        for (Map.Entry<String, int[]> entry : roomRecords.entrySet()) {
            int[] r = entry.getValue();
            Map<String, Integer> rec = new LinkedHashMap<>();
            rec.put("wins", r[0]);
            rec.put("losses", r[1]);
            rec.put("draws", r[2]);
            result.put(entry.getKey(), rec);
        }
        return result;
    }

    public void removeByRoom(String roomId) {
        records.remove(roomId);
        Iterator<Map.Entry<String, Map<String, String>>> it = activeGames.entrySet().iterator();
        while (it.hasNext()) {
            if (roomId.equals(it.next().getValue().get("roomId"))) {
                it.remove();
            }
        }
    }
}
