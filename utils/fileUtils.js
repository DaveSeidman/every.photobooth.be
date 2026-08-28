import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";

export function ensureDirectories(directories) {
  for (const directory of directories) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

export function createUploadMiddleware(uploadDirectory, maxBytes) {
  const storage = multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, uploadDirectory),
    filename: (_request, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase() || ".jpg";
      callback(null, `capture-${Date.now()}-${crypto.randomUUID()}${extension}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_request, file, callback) => {
      if (!file.mimetype.startsWith("image/")) {
        callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "photo"));
        return;
      }
      callback(null, true);
    },
  });
}
