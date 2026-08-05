export const config = { maxDuration: 60 };

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}

async function fetchWithRetry(url, retries = 2){
  for(let i=0; i<retries; i++){
    try{
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      const r = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if(r.ok){
        const buf = await r.arrayBuffer();
        if(buf.byteLength > 8000) return buf; // valid image
      }
    }catch(e){
      console.log(`Retry ${i+1} failed:`, e.message);
    }
    await new Promise(res => setTimeout(res, 1000));
  }
  return null;
}

export default async function handler(req, res){
  cors(res);
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try{
    const { prompt } = req.body || {};
    if(!prompt || prompt.trim().length < 3){
      return res.status(400).json({ error: 'Prompt chahiye (min 3 chars)' });
    }

    const clean = prompt.trim();
    const enhanced = `${clean}, ultra detailed, 8k, sharp focus, cinematic lighting, highly detailed, masterpiece`;
    const encoded = encodeURIComponent(enhanced);
    const seed = Math.floor(Math.random() * 9999999);
    const cacheBuster = Date.now();

    const urls = [
      `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&model=flux&seed=${seed}&enhance=true&nologo=true&nofeed=true&cb=${cacheBuster}`,
      `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&model=turbo&seed=${seed}&nologo=true&nofeed=true&cb=${cacheBuster}`
    ];

    for(let url of urls){
      const buffer = await fetchWithRetry(url);
      if(buffer){
        return res.status(200).json({
          image: Buffer.from(buffer).toString('base64'),
          model: 'flux-hd',
          success: true
        });
      }
    }

    return res.status(500).json({ error: 'Servers busy hai, 10 sec baad try karo' });

  }catch(e){
    console.error('Generate Error:', e);
    return res.status(500).json({ error: e.message || 'Generation failed' });
  }
}
