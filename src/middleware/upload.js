import multer from 'multer';
import path from 'path';
import fs from 'fs';

const UPLOAD_DIR  = path.join(__dirname, '../../uploads');
const MAX_SIZE    = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024; // 5 MB

// Ensure upload directories exist
['permits', 'valid_ids', 'reports'].forEach(dir => {
  const full = path.join(UPLOAD_DIR, dir);
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
});

const storage = multer.diskStorage({
  destination(req, file, cb) {
    let sub = 'misc';
    if (file.fieldname === 'permit_file')  sub = 'permits';
    if (file.fieldname === 'valid_id')     sub = 'valid_ids';
    cb(null, path.join(UPLOAD_DIR, sub));
  },
  filename(req, file, cb) {
    const ext  = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, name);
  },
});

function fileFilter(req, file, cb) {
  const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
  const ext     = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) return cb(null, true);
  cb(new Error(`File type ${ext} is not allowed. Accepted: ${allowed.join(', ')}`));
}

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE } });

export default upload;