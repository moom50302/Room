package org.example.service;

import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class GachaService {

    private final Map<String, List<GachaPool>> gachaPools = new ConcurrentHashMap<>();
    private final Random random = new Random();

    public GachaPool createPool(String roomId, String poolName, String creator,
                                int maxDrawPerIp, List<Prize> prizes) {
        String poolId = UUID.randomUUID().toString().substring(0, 8);
        GachaPool pool = new GachaPool();
        pool.poolId = poolId;
        pool.poolName = poolName;
        pool.creator = creator;
        pool.maxDrawPerIp = maxDrawPerIp;
        pool.prizes = prizes;
        pool.ipDrawCount = new ConcurrentHashMap<>();
        pool.drawHistory = Collections.synchronizedList(new ArrayList<DrawRecord>());

        gachaPools.computeIfAbsent(roomId, k -> Collections.synchronizedList(new ArrayList<GachaPool>()));
        gachaPools.get(roomId).add(pool);
        return pool;
    }

    public boolean deletePool(String roomId, String poolId, String nickname) {
        List<GachaPool> pools = gachaPools.get(roomId);
        if (pools == null) return false;
        return pools.removeIf(p -> p.poolId.equals(poolId) && p.creator.equals(nickname));
    }

    public Map<String, Object> draw(String roomId, String poolId, String ip, String nickname) {
        GachaPool pool = findPool(roomId, poolId);
        if (pool == null) return errorResult("抽賞不存在");

        // Check IP limit
        if (pool.maxDrawPerIp > 0) {
            int count = pool.ipDrawCount.getOrDefault(ip, 0);
            if (count >= pool.maxDrawPerIp) {
                return errorResult("已達到此 IP 的抽獎上限（" + pool.maxDrawPerIp + " 次）");
            }
        }

        // Collect available prizes
        List<Prize> available = new ArrayList<>();
        for (Prize p : pool.prizes) {
            if (p.remaining > 0) {
                available.add(p);
            }
        }
        if (available.isEmpty()) {
            return errorResult("所有獎品已抽完");
        }

        // Weighted random draw based on remaining count
        int totalRemaining = 0;
        for (Prize p : available) {
            totalRemaining += p.remaining;
        }
        int roll = random.nextInt(totalRemaining);
        Prize won = null;
        int cumulative = 0;
        for (Prize p : available) {
            cumulative += p.remaining;
            if (roll < cumulative) {
                won = p;
                break;
            }
        }

        if (won == null) return errorResult("抽獎錯誤");

        // Deduct
        won.remaining--;

        // Record IP draw count
        pool.ipDrawCount.merge(ip, 1, Integer::sum);

        // Record history
        DrawRecord record = new DrawRecord();
        record.nickname = nickname;
        record.ip = ip;
        record.prizeName = won.name;
        record.timestamp = System.currentTimeMillis();
        pool.drawHistory.add(record);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("poolId", poolId);
        result.put("poolName", pool.poolName);
        result.put("drawer", nickname);
        result.put("prizeName", won.name);
        return result;
    }

    public List<GachaPool> getPoolsByRoom(String roomId) {
        return gachaPools.getOrDefault(roomId, Collections.<GachaPool>emptyList());
    }

    public void removeByRoom(String roomId) {
        gachaPools.remove(roomId);
    }

    private GachaPool findPool(String roomId, String poolId) {
        List<GachaPool> pools = gachaPools.get(roomId);
        if (pools == null) return null;
        for (GachaPool p : pools) {
            if (p.poolId.equals(poolId)) return p;
        }
        return null;
    }

    private Map<String, Object> errorResult(String message) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", false);
        result.put("error", message);
        return result;
    }

    // Inner classes

    public static class GachaPool {
        public String poolId;
        public String poolName;
        public String creator;
        public int maxDrawPerIp;
        public List<Prize> prizes;
        public Map<String, Integer> ipDrawCount;
        public List<DrawRecord> drawHistory;
    }

    public static class Prize {
        public String name;
        public int total;
        public int remaining;

        public Prize() {}

        public Prize(String name, int total) {
            this.name = name;
            this.total = total;
            this.remaining = total;
        }
    }

    public static class DrawRecord {
        public String nickname;
        public String ip;
        public String prizeName;
        public long timestamp;
    }
}
