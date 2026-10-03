export const DEFAULT_DEEPGRAM_KEYTERMS =
  'Chetan,Sejal,Myra,Richera,Axerai,naam,mera,meri,girlfriend,bracelet,birthday,occasion,Jalgaon,Mohadi,Shirsoli,Mehfil,sunflower,Hinglish,gift'

export function appendDeepgramKeyterms(params, raw) {
  const source = String(raw ?? DEFAULT_DEEPGRAM_KEYTERMS).trim()
  for (const term of source.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean)) {
    params.append('keyterm', term)
  }
}
