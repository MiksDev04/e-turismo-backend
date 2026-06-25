import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DIR  = path.join(__dirname, '../../uploads');
const MAX_SIZE    = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024; // 5 MB

const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
  const ext     = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) return cb(null, true);
  cb(new Error(`File type ${ext} is not allowed. Accepted: ${allowed.join(', ')}`));
}

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE } });

export default upload;