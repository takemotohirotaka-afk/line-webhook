export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Hello");
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;

      const userId = event.source.userId;
      const replyToken = event.replyToken;
if (event.message.type === "image") {
  const messageId = event.message.id;

  // LINEから画像本体を取得
  const imageRes = await fetch(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    }
  );

  const arrayBuffer = await imageRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const fileName = `${Date.now()}-${messageId}.jpg`;

 const nowIso = new Date().toISOString();
const threeMinutesAgoIso = new Date(Date.now() - 1 * 60 * 1000).toISOString();

// 3分以内の collecting inquiry を探す
let inquiryRes = await fetch(
  `${SUPABASE_URL}/rest/v1/inquiries?user_id=eq.${userId}&status=eq.collecting&last_message_at=gte.${encodeURIComponent(oneMinuteAgoIso)}&order=created_at.desc&limit=1`,
  {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  }
);

let inquiries = await inquiryRes.json();
let inquiryId;

if (inquiries.length === 0) {
  let createRes = await fetch(`${SUPABASE_URL}/rest/v1/inquiries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      user_id: userId,
      status: "collecting",
      last_message_at: nowIso,
    }),
  });

  let newInquiry = await createRes.json();
  inquiryId = newInquiry[0].id;
} else {
  inquiryId = inquiries[0].id;

  await fetch(`${SUPABASE_URL}/rest/v1/inquiries?id=eq.${inquiryId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({
      last_message_at: nowIso,
    }),
  });
}

  // Supabase Storageに保存
  await fetch(
  `${SUPABASE_URL}/storage/v1/object/line-images/${fileName}`,
  {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "image/jpeg",
      "x-upsert": "true",
    },
    body: buffer,
  }
);

  const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/line-images/${fileName}`;

  // messages テーブルに保存
  await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({
      inquiry_id: inquiryId,
      type: "image",
      image_url: imageUrl,
    }),
  });
// last_message_at 更新
await fetch(`${SUPABASE_URL}/rest/v1/inquiries?id=eq.${inquiryId}`, {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  },
  body: JSON.stringify({
    last_message_at: new Date().toISOString(),
  }),
});
  continue;
}
      // ① inquiry取得 or 作成
      let inquiryRes = await fetch(
        `${SUPABASE_URL}/rest/v1/inquiries?user_id=eq.${userId}&status=eq.collecting`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );

      let inquiries = await inquiryRes.json();
      let inquiryId;

      if (inquiries.length === 0) {
        // 新規作成
        let createRes = await fetch(`${SUPABASE_URL}/rest/v1/inquiries`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            user_id: userId,
            status: "collecting",
          }),
        });

        let newInquiry = await createRes.json();
        inquiryId = newInquiry[0].id;
      } else {
        inquiryId = inquiries[0].id;
      }

      // ② メッセージ保存
      let messageData = {
        inquiry_id: inquiryId,
        type: event.message.type,
        text: event.message.text || null,
        image_url: null,
      };

      await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify(messageData),
      });

      // ③ とりあえず返信
      await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          replyToken: replyToken,
          messages: [
            {
              type: "text",
              text: "内容を受け付けました。",
            },
          ],
        }),
      });
    }

    return res.status(200).json({ status: "OK" });
  } catch (error) {
    console.error(error);
    return res.status(200).json({ status: "error", message: error.message });
  }
}
