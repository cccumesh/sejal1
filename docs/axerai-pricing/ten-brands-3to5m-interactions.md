# Axerai — 10 Brands Scale (3–5M interactions)

## Setup
- **10 brands** onboard (perfume, shoes, jewellery, lifestyle / Red Bull type)
- **3–5 million interactions** total (platform / year style campaign math)
- 1 interaction ≈ **₹5-slot**: ~10k voice chars + ~1.5L Gemini tokens + **~30 min** baat

---

## Per brand share (equal split)

| Total interactions | Per brand | Talk time / brand (30 min each) |
|--|--|--|
| **3M** | **3,00,000** | **1,50,000 hours** ≈ huge — see GPU note |
| **5M** | **5,00,000** | **2,50,000 hours** |

Practical monthly (agar 1 year mein fail):

| | 3M / year | 5M / year |
|--|--|--|
| Interactions / month (all 10) | **2.5L** | **~4.2L** |
| Per brand / month | **25,000** | **~42,000** |
| Engagement hours / brand / month | **12,500 hr** | **~21,000 hr** |

*(30 min × scans — theoretical max agar har interaction full 30 min ho)*

---

## Own TTS server capacity

1 GPU @ ~**200M chars/mo** + ₹5-slot (**10k chars** voice)  
→ **~20,000 interactions / month / GPU**

| Target | GPUs needed | Rent ≈ ₹50k × GPUs |
|--|--|--|
| 3M / year (2.5L / mo) | **~13 GPUs** | **~₹6.5L / mo** |
| 5M / year (4.2L / mo) | **~21 GPUs** | **~₹10.5L / mo** |

**Gemini (Flash-Lite) alag bill** (approx):
- 3M × 1.5L tokens ≈ bahut bada — agar average interaction **chhota** ho to kam  
- Realistic AR: bahut scans **5–12 min** (₹2–₹3 slot) → tokens/chars kam, GPU count ~**half** ho sakta hai

### Lighter AR mix (₹2-slot ~12 min, 4k chars)
1 GPU → **~50,000 interactions / mo**

| Target | GPUs | Rent |
|--|--|--|
| 3M / year | **~5 GPUs** | **~₹2.5L / mo** |
| 5M / year | **~9 GPUs** | **~₹4.5L / mo** |

---

## Inworld (abhi) — same 3–5M @ ₹5-slot (~₹27 each)

| | 3M | 5M |
|--|--|--|
| Voice+Gemini bill | **~₹8.1 crore** | **~₹13.5 crore** |

Vs own stack (GPU rent + Gemini, lighter mix): **lakhs/mo** not crores — yahi future win.

---

## Example brand mix (10 brands, 5M / year equal)

| Brand type | Scans / year | Scans / month | If avg 12 min | If avg 30 min |
|--|--|--|--|--|
| Perfume | 5L | ~42k | ~8,400 hr | ~21,000 hr |
| Shoes | 5L | ~42k | ~8,400 hr | ~21,000 hr |
| Jewellery | 5L | ~42k | ~8,400 hr | ~21,000 hr |
| Lifestyle / Red Bull | 5L | ~42k | ~8,400 hr | ~21,000 hr |
| (+ 6 more same) | 5L each | ~42k each | … | … |

---

## Founder snapshot
| | |
|--|--|
| 10 brands + **3–5M** interactions / year | Enterprise scale |
| Own TTS | **~5–21 GPUs** → **₹2.5L–10.5L / mo** (avg session length pe) |
| Inworld same volume | **Crores** |
| Per brand monthly scans | **~25k–42k** (equal split) |

**Note:** Har scan full 30 min rare hai. Perfume/jewellery aksar shorter; Red Bull campaign spikes. Capacity planning **avg minutes × scans** se karo.
