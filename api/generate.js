
// /api/generate.js — Vercel Serverless
// Free HF Inference API — uses HF_TOKEN env
// Primary: black-forest-labs/FLUX.1-schnell (fast, high quality)
// Fallback: stabilityai/sdxl-turbo (if 429/503 or error)

export const config = { maxDuration: 60 };

const PRIMARY = "black-forest-labs/FLUX.1-schnell";
const FALLBACK = "stabilityai/sdxl-turbo";

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
}

function hfUrl(model){
  // New HF router endpoint (works with classic /models/ too)
  return `https://api-inference.huggingface.co/models/${model}`;
}

async function callHF(model, prompt, token){
  const resp = await fetch(hfUrl(model), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-wait-for-model': 'true',
      'x-use-cache': 'false'
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: { guidance_scale: 3.5, num_inference_steps: 8 },
      options: { wait_for_model: true, use_cache: false }
    })
  });

  // HF returns binary image on 200, JSON error otherwise
  if(!resp.ok){
    const text = await resp.text();
    let errJson;
    try{ errJson = JSON.parse(text); }catch{}
    const msg = errJson?.error || text || `HF ${resp.status}`;
    const e = new Error(msg);
    e.status = resp.status;
    e.body = text;
    throw e;
  }

  const contentType = resp.headers.get('content-type') || '';
  if(contentType.includes('application/json')){
    // Some models return json with base64
    const j = await resp.json();
    if(j.image) return { buffer: Buffer.from(j.image, 'base64'), contentType: 'image/png' };
    throw new Error('Unexpected JSON response from HF');
  }

  const arrayBuffer = await resp.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType: contentType || 'image/png' };
}

export default async function handler(req, res){
  cors(res);
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.HF_TOKEN;
  if(!token) return res.status(500).json({ error: 'HF_TOKEN not set in Vercel env. Add in Dashboard → Settings → Env Variables' });

  try{
    const { prompt, ratio } = req.body || {};
    if(!prompt || typeof prompt !== 'string' || prompt.trim().length < 3){
      return res.status(400).json({ error: 'Prompt required (min 3 chars)' });
    }

    // Optional: append ratio hint to prompt for models that respect it
    let finalPrompt = prompt.trim();
    if(ratio && ratio !== '1024x1024'){
      finalPrompt += ` — aspect ratio ${ratio.replace('x',':')}`;
    }

    let result, usedModel = PRIMARY, isFallback = false;

    try{
      result = await callHF(PRIMARY, finalPrompt, token);
    }catch(err){
      console.warn('[generate] primary failed', PRIMARY, err.message, 'status', err.status);
      // Retry fallback on 429, 503, 500, 504, or model loading
      const shouldFallback = [429,503,500,504].includes(err.status) || /loading|currently|busy|rate|limit/i.test(err.message);
      if(!shouldFallback) throw err;
      try{
        result = await callHF(FALLBACK, finalPrompt, token);
        usedModel = FALLBACK;
        isFallback = true;
      }catch(err2){
        console.error('[generate] fallback failed', err2.message);
        throw new Error(`Both models failed. Primary: ${err.message} | Fallback: ${err2.message}`);
      }
    }

    const base64 = result.buffer.toString('base64');
    return res.status(200).json({
      image: base64,
      model: usedModel,
      fallback: isFallback,
      contentType: result.contentType
    });

  }catch(e){
    console.error('[generate] error', e);
    return res.status(500).json({ error: e.message || 'Generation failed', details: e.body?.slice?.(0,500) });
  }
}
