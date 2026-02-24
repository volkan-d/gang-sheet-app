// 1. Import canvas FIRST to avoid macOS conflict with sharp (libvips/cairo conflict)
const canvas = require('canvas'); 
const sharp = require('sharp'); 

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');

// 2. Import Konva and handle ESM/CommonJS interop
let Konva = require('konva');
if (Konva.default) {
    Konva = Konva.default;
}

// 3. Connect Konva to node-canvas - CRITICAL for server-side rendering
// Konva needs DOM-like environment, so we need to mock it properly
if (typeof global !== 'undefined') {
    // Mock window object
    if (!global.window) {
        global.window = {
            devicePixelRatio: 1,
            innerWidth: 1920,
            innerHeight: 1080
        };
    }
    
    // Mock document object
    if (!global.document) {
        global.document = {
            createElement: function(tagName) {
                if (tagName === 'canvas') {
                    const nodeCanvas = new canvas.Canvas(1, 1);
                    // Add style object that Konva expects
                    if (!nodeCanvas.style) {
                        nodeCanvas.style = {};
                    }
                    return nodeCanvas;
                }
                if (tagName === 'img') {
                    return new canvas.Image();
                }
                return {};
            },
            createElementNS: function(ns, tagName) {
                return global.document.createElement(tagName);
            }
        };
    }
}

if (Konva.Util) {
    // Override canvas creation to use node-canvas
    const originalCreateCanvas = Konva.Util.createCanvasElement;
    Konva.Util.createCanvasElement = function() {
        const nodeCanvas = new canvas.Canvas(1, 1);
        // Add style object that Konva's Canvas class expects
        if (!nodeCanvas.style) {
            nodeCanvas.style = {};
        }
        // Add other properties Konva might check
        if (!nodeCanvas.getContext) {
            nodeCanvas.getContext = function(type) {
                return this.getContext(type);
            };
        }
        return nodeCanvas;
    };
    
    // Override image creation to use node-canvas
    Konva.Util.createImageElement = function() {
        return new canvas.Image();
    };
    
    console.log("✅ Konva configured for node-canvas");
} else {
    console.warn("⚠️ Warning: Konva.Util not found. Server-side rendering might fail.");
}

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '50mb' }));
app.use(cors());

// --- Database Setup ---
if (!process.env.DATABASE_URL) {
    console.error("❌ ERROR: DATABASE_URL is missing in .env");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.query('SELECT NOW()').catch(err => console.error("❌ DB Connection Failed:", err.message));

// --- Cloudflare R2 Config ---
let r2Endpoint = process.env.R2_ENDPOINT || '';
const bucketName = process.env.R2_BUCKET_NAME || '';

if (r2Endpoint.endsWith(bucketName)) {
    r2Endpoint = r2Endpoint.replace(new RegExp(`/${bucketName}/?$`), '');
}

let publicUrlBase = process.env.R2_PUBLIC_URL || '';
if (publicUrlBase.endsWith('/')) {
    publicUrlBase = publicUrlBase.slice(0, -1);
}

const s3 = new S3Client({
    region: 'auto',
    endpoint: r2Endpoint,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY,
    }
});

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }
});

async function uploadToS3(buffer, filename, mimeType) {
    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: filename,
        Body: buffer,
        ContentType: mimeType,
    });
    await s3.send(command);
    return `${publicUrlBase}/${filename}`;
}

// --- Routes ---

app.post('/api/upload', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(req.file.originalname);
    const filename = uniqueSuffix + ext;
    
    // Generate names
    const originalFilename = `hq-${filename}`;
    const thumbFilename = `thumb-${filename}`;

    try {
        console.log(`🖼️ Processing: ${req.file.originalname}`);

        // 1. Upload Original (High Res)
        const originalUrl = await uploadToS3(req.file.buffer, originalFilename, req.file.mimetype);
        
        // 2. Generate & Upload Thumbnail (Low Res)
        const thumbBuffer = await sharp(req.file.buffer)
            .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
            .toBuffer();
        
        const thumbUrl = await uploadToS3(thumbBuffer, thumbFilename, req.file.mimetype);

        console.log(`✅ Uploaded. Thumb: ${thumbFilename}`);

        res.json({ 
            url: thumbUrl,        
            highResUrl: originalUrl, 
            filename: thumbFilename,
            originalName: req.file.originalname
        });
    } catch (err) {
        console.error("❌ Upload/Resize Error:", err);
        res.status(500).json({ error: "Upload failed." });
    }
});

app.post('/api/designs', async (req, res) => {
    const { id, data } = req.body;
    if (!id || !data) return res.status(400).json({ error: 'Missing id or data' });
    try {
        const query = `INSERT INTO designs (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2`;
        await pool.query(query, [id, JSON.stringify(data)]);
        res.json({ message: 'Design saved', id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/designs/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT data FROM designs WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(JSON.parse(result.rows[0].data));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Test endpoint to verify canvas setup
app.get('/api/test-export', async (req, res) => {
    try {
        console.log("🧪 Testing canvas export setup...");
        
        const testCanvas = new canvas.Canvas(200, 200);
        const ctx = testCanvas.getContext('2d');
        
        // Draw a test pattern
        ctx.fillStyle = 'blue';
        ctx.fillRect(50, 50, 100, 100);
        ctx.fillStyle = 'red';
        ctx.fillRect(75, 75, 50, 50);
        
        const testBuffer = testCanvas.toBuffer('image/png');
        console.log("✅ Canvas test passed");
        
        res.setHeader('Content-Type', 'image/png');
        res.send(testBuffer);
    } catch (err) {
        console.error("❌ Test failed:", err);
        res.status(500).json({ 
            success: false,
            error: err.message,
            stack: err.stack
        });
    }
});

app.post('/api/export', async (req, res) => {
    const { size, objects } = req.body;
    if (!size || !objects) {
        return res.status(400).json({ error: "Missing size or objects data" });
    }

    if (!Array.isArray(objects) || objects.length === 0) {
        return res.status(400).json({ error: "No objects to export" });
    }

    console.log("🚀 Starting Server-Side Export...");
    const start = Date.now();

    try {
        const SCALE_FACTOR = 300 / 96; 
        const stageWidth = Math.ceil(size.width * SCALE_FACTOR);
        const stageHeight = Math.ceil(size.height * SCALE_FACTOR);

        // Create canvas directly using node-canvas (more reliable than Konva Stage)
        const canvasElement = new canvas.Canvas(stageWidth, stageHeight);
        const ctx = canvasElement.getContext('2d');

        const imageObjects = objects.filter(obj => obj.type === 'image');
        if (imageObjects.length === 0) {
            return res.status(400).json({ error: "No image objects to export" });
        }

        // Load all images first
        const imageData = await Promise.all(imageObjects.map(async (obj) => {
            const imageUrl = obj.highResSrc || obj.src;
            
            if (!imageUrl) {
                console.warn(`⚠️ Object ${obj.id} has no image URL`);
                return null;
            }

            try {
                console.log(`📥 Loading image: ${imageUrl}`);
                const response = await axios.get(imageUrl, { 
                    responseType: 'arraybuffer',
                    timeout: 30000,
                    maxContentLength: 100 * 1024 * 1024,
                });
                
                const buffer = Buffer.from(response.data);
                const img = new canvas.Image();
                img.src = buffer;

                // Wait for image to load
                await new Promise((resolve, reject) => {
                    if (img.complete || img.width > 0) {
                        resolve(img);
                    } else {
                        img.onload = () => resolve(img);
                        img.onerror = (err) => reject(new Error(`Image load failed`));
                        // Timeout after 5 seconds
                        setTimeout(() => reject(new Error('Image load timeout')), 5000);
                    }
                });

                console.log(`✅ Loaded image: ${imageUrl} (${img.width}x${img.height})`);
                return {
                    image: img,
                    obj: obj,
                    success: true
                };
            } catch (err) {
                console.error(`❌ Failed to load image ${imageUrl}:`, err.message);
                return {
                    image: null,
                    obj: obj,
                    success: false,
                    error: err.message
                };
            }
        }));

        const successfulImages = imageData.filter(item => item && item.success);
        const successCount = successfulImages.length;
        
        if (successCount === 0) {
            return res.status(500).json({ 
                error: "Failed to load any images. Please ensure images are uploaded and accessible." 
            });
        }

        if (successCount < imageObjects.length) {
            console.warn(`⚠️ Only ${successCount}/${imageObjects.length} images loaded successfully`);
        }

        // Draw all images to canvas
        console.log(`🎨 Drawing ${successCount} images to canvas...`);
        successfulImages.forEach(({ image, obj }) => {
            if (!image) return;

            ctx.save();
            
            // Calculate position and dimensions
            const x = obj.x * SCALE_FACTOR;
            const y = obj.y * SCALE_FACTOR;
            const width = obj.width * SCALE_FACTOR * (obj.scaleX || 1);
            const height = obj.height * SCALE_FACTOR * (obj.scaleY || 1);
            const rotation = (obj.rotation || 0) * Math.PI / 180;

            // Move to center of image, rotate, then draw
            ctx.translate(x + width / 2, y + height / 2);
            ctx.rotate(rotation);
            ctx.drawImage(image, -width / 2, -height / 2, width, height);
            
            ctx.restore();
        });

        console.log(`✅ Canvas drawn: ${canvasElement.width}x${canvasElement.height}`);

        // Convert canvas to buffer with 300 DPI
        console.log(`💾 Converting canvas to buffer at 300 DPI...`);
        let buffer;
        try {
            // First get the PNG buffer from canvas
            const pngBuffer = canvasElement.toBuffer('image/png');
            if (!pngBuffer || pngBuffer.length === 0) {
                throw new Error("Canvas buffer is empty");
            }
            
            // Use sharp to set DPI metadata to 300
            // Sharp expects density in pixels per inch
            buffer = await sharp(pngBuffer)
                .withMetadata({ density: 300 })
                .png()
                .toBuffer();
            
            if (!buffer || buffer.length === 0) {
                throw new Error("Sharp buffer is empty");
            }
            console.log(`✅ Buffer created at 300 DPI: ${(buffer.length / 1024).toFixed(2)}KB`);
        } catch (bufferErr) {
            console.error("❌ Failed to convert canvas to buffer:", bufferErr);
            throw new Error(`Failed to convert canvas to buffer: ${bufferErr.message}`);
        }

        console.log(`✅ Export Finished in ${(Date.now() - start) / 1000}s (${successCount} images, ${(buffer.length / 1024).toFixed(2)}KB)`);

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="gang-sheet-HQ-${Date.now()}.png"`);
        res.send(buffer);

    } catch (err) {
        console.error("❌ Export Error:", err);
        res.status(500).json({ 
            error: "Failed to generate image",
            details: err.message 
        });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));