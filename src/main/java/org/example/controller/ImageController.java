package org.example.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@RestController
public class ImageController {

    private static final String UPLOAD_DIR = "uploads";
    private static final long MAX_SIZE = 5 * 1024 * 1024; // 5MB

    @PostMapping("/api/upload")
    public ResponseEntity<Map<String, String>> upload(@RequestParam("file") MultipartFile file) {
        Map<String, String> result = new LinkedHashMap<>();

        if (file.isEmpty()) {
            result.put("error", "No file");
            return ResponseEntity.badRequest().body(result);
        }
        if (file.getSize() > MAX_SIZE) {
            result.put("error", "File too large (max 5MB)");
            return ResponseEntity.badRequest().body(result);
        }

        String contentType = file.getContentType();
        if (contentType == null || !contentType.startsWith("image/")) {
            result.put("error", "Only image files allowed");
            return ResponseEntity.badRequest().body(result);
        }

        String originalName = file.getOriginalFilename();
        String ext = "";
        if (originalName != null && originalName.contains(".")) {
            ext = originalName.substring(originalName.lastIndexOf('.'));
        }
        String fileName = UUID.randomUUID().toString() + ext;

        File dir = new File(UPLOAD_DIR);
        if (!dir.exists()) {
            dir.mkdirs();
        }

        try {
            File dest = new File(dir, fileName);
            file.transferTo(dest);
            result.put("url", "/uploads/" + fileName);
            return ResponseEntity.ok(result);
        } catch (IOException e) {
            result.put("error", "Upload failed");
            return ResponseEntity.internalServerError().body(result);
        }
    }
}
