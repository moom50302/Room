這是一個使用 Claude 建立的線上即時討論區，當服務關閉時不會留下任何資料與紀錄

使用 Intellij 可開啟服務，目前沒有打包出可直接執行的檔案

使用 localhost:8080 進入

技術架構
框架	Spring Boot 2.7.18 + Java 8
即時通訊	STOMP over SockJS (WebSocket)
前端模板	Thymeleaf
建構工具	Gradle Kotlin DSL
資料儲存	ConcurrentHashMap（記憶體內）
