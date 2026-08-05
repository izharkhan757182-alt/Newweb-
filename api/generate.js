export const config = { maxDuration: 60 };

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}

async function fetchWithRetry(url, retries = 3){
  for(let i=0; i<retries; i++){
    try{
      const r = await fetch(url, { cache: 'no-store' });
      if(r.ok) return r;
      console.log(`Attempt ${i+1} failed: ${r.status}`);
      await new Promise(r => setTimeout(r, 1000 * (i+1))); // wait 1s, 2s, 3s
    }catch(e){
      console.log(`Attempt ${i+1} error:`, e.message);
    }
  }
  return null;
}

export default async function handler(req, res){
  cors(res);
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method!== 'POST') return res.status(405).json({ error: 'POST only' });

  try{
    const { prompt } = req.body || {};
    if(!prompt) return res.status(400).json({ error: 'Prompt required' });

    const cleanPrompt = prompt.trim();
    const enhanced = `${cleanPrompt}, 8k, ultra detailed, cinematic lighting, sharp focus, highly detailed, masterpiece`;
    const encoded = encodeURIComponent(enhanced);
    const seed = Math.floor(Math.random() * 1000000);

    // 3 BACKUP SERVERS
    const urls = [
      `https://image.pollinations.ai/prompt/${encoded}?width=1280&height=1280&model=flux&seed=${seed}&enhance=true&nologo=true&nofeed=true&nocache=${Date.now()}`,
      `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&model=flux-pro&seed=${seed}&enhance=true&nologo=true&nocache=${Date.now()}`,
      `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&model=turbo&seed=${seed}&nologo=true&nocache=${Date.now()}`
    ];

    for(let url of urls){
      const imgRes = await fetchWithRetry(url, 2);
      if(imgRes){
        const buffer = await imgRes.arrayBuffer();
        // Check if it's actually an image (not error html)
        if(buffer.byteLength > 10000){
          return res.status(200).json({
            image: Buffer.from(buffer).toString('base64'),
            model: 'flux-hd'
          });
        }
      }
    }

    throw new Error('All 3 servers busy - 10 sec baad try karo');

  }catch(e){
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
