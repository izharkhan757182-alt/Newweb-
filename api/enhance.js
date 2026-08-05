
// /api/enhance.js — Vercel Serverless
// Accepts { imageBase64, mode: 'upscale' | 'face' | 'both' }
// Primary: stabilityai/stable-diffusion-x4-upscaler (general 4x)
// Fallback: fal-ai/esrgan or face: sczhou/codeformer or Xintao/GFPGAN alternative
// Uses HF_TOKEN. Returns base64 image.

export const config = { maxDuration: 60 };

const MODELS = {
  upscale: "stabilityai/stable-diffusion-x4-upscaler",
  // HF often doesn't have Real-ESRGAN as inference, so we use SD x4 upscaler as primary,
  // and try a second generic upscaler as fallback
  upscale_fallback: "fal-ai/esrgan",
  face: "sczhou/codeformer",
  face_fallback: "Xintao/GFPGAN"
};

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}

function hfUrl(model){
  return `https://router.huggingface.co/hf-inference/models/${model}`;
}

// Helper: call HF with image-to-image / image input
async function callHFImage(model, imageBuffer, token, extraParams={}){
  // Many HF upscalers accept binary image
  const resp = await fetch(hfUrl(model), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'x-wait-for-model': 'true'
    },
    body: imageBuffer
  });

  if(!resp.ok){
    const txt = await resp.text();
    let j; try{ j=JSON.parse(txt);}catch{}
    const msg = j?.error || txt || `HF ${resp.status}`;
    const e = new Error(msg);
    e.status = resp.status;
    e.body = txt;
    throw e;
  }

  const ct = resp.headers.get('content-type')||'';
  if(ct.includes('application/json')){
    const data = await resp.json();
    // Some return {image: base64}
    if(data.image) return { buffer: Buffer.from(data.image,'base64'), contentType: 'image/png' };
    if(data[0]?.generated_image) return { buffer: Buffer.from(data[0].generated_image,'base64'), contentType: 'image/png' };
    throw new Error('Unexpected JSON from HF upscaler');
  }

  const ab = await resp.arrayBuffer();
  return { buffer: Buffer.from(ab), contentType: ct || 'image/png' };
}

// If HF upscaler models are not available for your token, we do a local sharp-like fallback?
// Here we keep it simple: if all HF fails, return original as "enhanced" with flag (so UI still works for demo)
// In production you can swap to Replicate API with REAL-ESRGAN.

export default async function handler(req, res){
  cors(res);
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const token = process.env.HF_TOKEN;
  if(!token) return res.status(500).json({ error: 'HF_TOKEN not set' });

  try{
    const { imageBase64, mode = 'upscale' } = req.body || {};
    if(!imageBase64) return res.status(400).json({ error: 'imageBase64 required (base64 string without data: prefix)' });

    let buffer;
    try{
      buffer = Buffer.from(imageBase64, 'base64');
    }catch{
      return res.status(400).json({ error: 'Invalid base64' });
    }
    if(buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Image too large, max 8MB' });

    let primaryModel, fallbackModel;
    if(mode === 'face'){
      primaryModel = MODELS.face;
      fallbackModel = MODELS.face_fallback;
    } else if(mode === 'both'){
      primaryModel = MODELS.upscale;
      fallbackModel = MODELS.face; // try face after upscale logic (simplified to one call)
    } else {
      primaryModel = MODELS.upscale;
      fallbackModel = MODELS.upscale_fallback;
    }

    let result, usedModel = primaryModel, isFallback=false;

    try{
      result = await callHFImage(primaryModel, buffer, token);
    }catch(e){
      console.warn('[enhance] primary failed', primaryModel, e.message);
      const shouldFallback = [429,503,500,504,404].includes(e.status) || /loading|not found|currently|No model/i.test(e.message);
      if(!shouldFallback) throw e;
      try{
        result = await callHFImage(fallbackModel, buffer, token);
        usedModel = fallbackModel;
        isFallback = true;
      }catch(e2){
        console.error('[enhance] fallback failed', e2.message);
        // Final graceful fallback: return original image as "enhanced" with note
        // Remove this in production if you want strict failure.
        // For demo/testing, this lets UI flow without breaking Vercel deploy.
        // Uncomment next line to make it strict:
        // throw new Error(`Both enhancers failed: ${e.message} | ${e2.message}`);
        
        // DEMO MODE: If HF upscalers unavailable (common on free tier), just echo back
        // In real prod, plug Replicate: https://replicate.com/nightmareai/real-esrgan
        return res.status(200).json({
          image: imageBase64,
          model: 'demo-passthrough (HF upscaler not available on free tier, wire Replicate for prod)',
          fallback: true,
          note: `HF failed: ${e.message} | ${e2.message}. Wire Replicate or fal.ai for guaranteed upscale.`
        });
      }
    }

    return res.status(200).json({
      image: result.buffer.toString('base64'),
      model: usedModel,
      fallback: isFallback,
      contentType: result.contentType
    });

  }catch(err){
    console.error('[enhance] error', err);
    return res.status(500).json({ error: err.message, details: err.body?.slice?.(0,400) });
  }
}
