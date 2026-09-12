import sharp from 'sharp';
import fs from 'fs';

const imgPath = "/Users/kahmeng/Documents/GitHub/hellomyphotos/logs_backend prod/IMG_0425.HEIC";

async function test() {
  try {
    console.log("Trying sharp without unlimited...");
    await sharp(imgPath).metadata();
    console.log("Success");
  } catch (err) {
    console.error("Failed without unlimited:", err.message);
  }

  try {
    console.log("Trying sharp with unlimited: true...");
    const meta = await sharp(imgPath, { unlimited: true }).metadata();
    console.log("Sharp metadata success:", meta.width, "x", meta.height);
  } catch (err) {
    console.error("Failed with unlimited:", err.message);
  }
}
test();
