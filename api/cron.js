export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  try {
    const now = Date.now();
    const oneMinuteMs = 60 * 1000;

    // ① collecting & 未返信 を全部取得
    const inquiryRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inquiries?status=eq.collecting&replied_at=is.null&order=created_at.asc`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const allInquiries = await inquiryRes.json();

    // ② JS側で1分経過したものだけ対象にする
    const inquiries = allInquiries.filter((inquiry) => {
      const baseTime = inquiry.last_message_at || inquiry.created_at;
      if (!baseTime) return false;
      return now - new Date(baseTime).getTime() >= oneMinuteMs;
    });

    for (const inquiry of inquiries) {
      const inquiryId = inquiry.id;
      const userId = inquiry.user_id;

      // ③ messages 取得
      const msgRes = await fetch(
        `${SUPABASE_URL}/rest/v1/messages?inquiry_id=eq.${inquiryId}&order=created_at.asc`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );

const messages = await msgRes.json();

const texts = messages
  .filter((m) => m.type === "text" && m.text)
  .map((m) => m.text);

const imageUrls = messages
  .filter((m) => m.type === "image" && m.image_url)
  .map((m) => m.image_url);

const keyword = texts.join(" ").trim().slice(0, 50) || "査定";

// 🔍 ブランド抽出
let detectedBrand = null;

try {
  const extractRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
const brandExtractInput = [
  {
    role: "system",
    content: [
      {
        type: "input_text",
        text: `あなたはブランド品査定の補助AIです。
ユーザーのテキストと画像から、ブランド名を1つだけ抽出してください。

ルール:
- ブランド名だけ返す
- 分からない場合は null
- 本物/偽物の断定はしない
- 余計な説明は書かない`
      }
    ]
  },
  {
    role: "user",
    content: [
      {
        type: "input_text",
        text: `ユーザーのテキスト:
${texts.length ? texts.join("\n") : "（テキストなし）"}`
      },
      ...imageUrls.map((imageUrl) => ({
        type: "input_image",
        image_url: imageUrl,
      }))
    ]
  }
];

const extractRes = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`,
  },
  body: JSON.stringify({
    model: "gpt-4.1-mini",
    input: brandExtractInput,
  }),
});
  const extractData = await extractRes.json();

console.log("detectedBrand raw:", JSON.stringify(extractData, null, 2));

detectedBrand =
  extractData.output?.[0]?.content?.[0]?.text?.trim() || null;

console.log("detectedBrand parsed:", detectedBrand);
} catch (e) {
  console.log("brand extract error:", e);
}

const brandFilter =
  detectedBrand && detectedBrand.toLowerCase() !== "null"
    ? `brand=ilike.*${encodeURIComponent(detectedBrand)}*`
    : `reply_text=ilike.*${encodeURIComponent(keyword)}*`;

// 過去査定を取得
let similarAppraisals = [];

try {
  const similarRes = await fetch(
    `${SUPABASE_URL}/rest/v1/appraisals?select=id,reply_text,created_at,brand,category,model_name,final_offer_min,final_offer_max,confidence&${brandFilter}&order=created_at.desc&limit=5`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );

  if (!similarRes.ok) {
    const similarError = await similarRes.text();
    console.log("similarRes error:", similarError);
  } else {
    similarAppraisals = await similarRes.json();
  }
} catch (e) {
  console.log("similar fetch error:", e);
}
const userContent = [];

userContent.push({
  type: "input_text",
  text: `以下はブランド査定のお問い合わせです。

ユーザーからのテキスト：
${texts.length ? texts.join("\n") : "（テキストなし）"}

上記テキストと商品画像をもとに、実務で送る査定文を1通だけ作成してください。`
});

userContent.push({
  type: "input_text",
  text: `以下は過去の査定履歴です。今回の査定文を作る参考にしてください。
ただし今回の商品と明らかに違う場合は無理に合わせないでください。

過去査定履歴:
${similarAppraisals.length ? JSON.stringify(similarAppraisals, null, 2) : "該当なし"}`
});

for (const imageUrl of imageUrls) {
  userContent.push({
    type: "input_image",
    image_url: imageUrl,
  });
}

      let replyText = `お問い合わせありがとうございます。
内容を確認いたしました。

お写真をもとに査定を進めてまいります。
追加で確認事項がある場合はご連絡させていただきます。`;

      // ④ OpenAIで査定文作成
      if (OPENAI_API_KEY) {
        const aiRes = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            text: {
              format: {
                type: "text"
              }
            },
            max_output_tokens: 500,
            input: [
              {
                role: "system",
                content: [
                  {
                    type: "input_text",
                    text: `あなたはブランド買取店の査定担当者です。
画像とユーザー文面から、実務ベースでリアルな査定コメントを作成してください。

【査定ルール】
- 中古買取相場ベースで出す
- 状態により±30%調整
- 過去査定履歴がある場合は、今回の商品と近い内容を参考にして査定文のブレを抑える
- 人気ブランドは強気
- ノーブランドは弱め
- 不明な場合は無理に断定しない
- 本物・偽物は断定しない

【参考相場感】
- ルイヴィトン バッグ：2万〜8万
- シャネル バッグ：5万〜30万
- エルメス バッグ：10万〜100万以上
- カルティエ 小物：1万〜5万
- ロレックス 時計：30万〜300万
- オメガ 時計：5万〜50万

【文体ルール】
- ビジネスLINE風
- 簡潔
- 商品名＋カテゴリ＋金額レンジ
- 最後に一言添える
- 画像枚数には触れない
- そのまま送れる完成文だけを出す

【出力イメージ】
いつも大変お世話になっております。
ご連絡ありがとうございます。

ルイヴィトン　バッグ　2.5〜3.0万

ご確認の程、よろしくお願いいたします。`
                  }
                ]
              },
              {
                role: "user",
                content: userContent
              }
            ]
          }),
        });

        const aiData = await aiRes.json();
        console.log("OpenAI raw response:", JSON.stringify(aiData, null, 2));

        if (aiData.error?.message) {
          replyText = `OpenAI error: ${aiData.error.message}`;
        } else if (aiData.output_text && aiData.output_text.trim()) {
          replyText = aiData.output_text.trim();
        } else {
          const textParts = [];

          if (Array.isArray(aiData.output)) {
            for (const item of aiData.output) {
              if (item.type === "message" && Array.isArray(item.content)) {
                for (const c of item.content) {
                  if (c.type === "output_text" && c.text) {
                    textParts.push(c.text);
                  }
                }
              }
            }
          }

          if (textParts.length > 0) {
            replyText = textParts.join("\n").trim();
          } else if (aiData.incomplete_details?.reason) {
            replyText = `OpenAI incomplete: ${aiData.incomplete_details.reason}`;
          } else {
            replyText = "OpenAI response was empty";
          }
        }
      }

      if (replyText.length > 4500) {
        replyText = replyText.slice(0, 4500);
      }

      // ⑤ LINEに push
      const pushRes = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_TOKEN}`,
        },
        body: JSON.stringify({
          to: userId,
          messages: [
            {
              type: "text",
              text: replyText,
            },
          ],
        }),
      });

      console.log("LINE push status:", pushRes.status);

      if (!pushRes.ok) {
        const lineError = await pushRes.text();
        console.log("LINE push error:", lineError);
        throw new Error(`LINE push failed: ${pushRes.status} ${lineError}`);
      }
// ⑥ appraisals に保存
await fetch(`${SUPABASE_URL}/rest/v1/appraisals`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  },
  body: JSON.stringify({
    inquiry_id: inquiryId,
    line_user_id: userId,

   brand: detectedBrand && detectedBrand.toLowerCase() !== "null"
  ? detectedBrand
  : null,
    category: null,
    model_name: null,
    reference_no: null,
    material: null,
    color: null,
    condition_rank: null,

    accessories: [],
    normalized_title: null,

    market_prices: [],
    past_similar_results: similarAppraisals ?? [],

    ai_estimated_min: null,
    ai_estimated_max: null,
    final_offer_min: null,
    final_offer_max: null,

    confidence: null,
   reasoning: {
  detectedBrand: detectedBrand ?? null,
  similarCount: similarAppraisals?.length ?? 0,
},
    reply_text: replyText,
  }),
});
      // ⑦ 返信済みに更新
      await fetch(`${SUPABASE_URL}/rest/v1/inquiries?id=eq.${inquiryId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          replied_at: new Date().toISOString(),
          reply_text: replyText,
        }),
      });
    }

    return res.status(200).json({
      ok: true,
      count: inquiries.length,
      total: allInquiries.length,
    });
  } catch (error) {
    console.error("cron error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
