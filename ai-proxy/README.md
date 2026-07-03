# AI Proxy সেটআপ গাইড

অ্যাপের "AI হাব" চালু করতে এই ছোট proxy টা একবার ডেপ্লয় করতে হবে।

## কেন proxy লাগে?

GitHub Pages একটা স্ট্যাটিক সাইট — এখানে API key রাখা যায় না, কারণ `index.html`-এ
যা-ই লিখবেন তা সবাই দেখতে পাবে এবং key চুরি হয়ে আপনার বিল বাড়বে। তাছাড়া ব্রাউজার
থেকে সরাসরি `api.anthropic.com` কল করা CORS-এর কারণে ব্লকও হয়। তাই key থাকবে
Cloudflare Worker-এ (ফ্রি), আর অ্যাপ কথা বলবে শুধু Worker-এর সাথে।

```
ব্রাউজার (islamic-app) ──▶ Cloudflare Worker (key এখানে) ──▶ Anthropic API
```

## ধাপে ধাপে (৫ মিনিট, ফ্রি)

1. **Cloudflare অ্যাকাউন্ট খুলুন** — <https://dash.cloudflare.com> (ফ্রি প্ল্যানই যথেষ্ট;
   Workers ফ্রি টিয়ারে দিনে ১ লাখ রিকোয়েস্ট)।
2. **Workers & Pages → Create → Create Worker** → নাম দিন (যেমন `islamic-ai-proxy`) → Deploy।
3. **Edit code** → এই ফোল্ডারের `worker.js` ফাইলের পুরো কন্টেন্ট পেস্ট করুন → Deploy।
4. **API key সেট করুন** — Worker → Settings → Variables and Secrets →
   **Add** → Type: *Secret* → Name: `ANTHROPIC_API_KEY` → Value: আপনার key
   (key পাবেন <https://platform.claude.com> → API Keys)।
5. Worker-এর URL কপি করুন — দেখতে এরকম:
   `https://islamic-ai-proxy.<আপনার-সাবডোমেন>.workers.dev`
6. **`index.html`-এ বসান** — `AI_PROXY_URL` খুঁজে (Ctrl+F) খালি স্ট্রিংয়ের জায়গায়
   URL টা দিন:

   ```js
   const AI_PROXY_URL = 'https://islamic-ai-proxy.xxxx.workers.dev';
   ```

7. কমিট + পুশ করুন। ব্যস — AI হাব চালু।

## খরচ নিয়ন্ত্রণ

`worker.js`-এর ভেতরে সীমা দেওয়া আছে:

- `MAX_TOKENS_CAP` — প্রতি উত্তরে সর্বোচ্চ টোকেন (ডিফল্ট 2048)
- `MAX_MESSAGES` / `MAX_CHARS` — ইতিহাস ও রিকোয়েস্টের আকার সীমিত
- `ALLOWED_ORIGIN` — শুধু আপনার সাইট থেকেই কল করা যাবে

মডেল বদলাতে চাইলে `MODEL` কনস্ট্যান্টটা বদলান (বর্তমানে `claude-sonnet-5`) —
সাইট রিডেপ্লয় করা লাগবে না।

> ⚠️ Anthropic Console-এ **Spend limit** সেট করে রাখুন — পাবলিক অ্যাপে এটা জরুরি।
