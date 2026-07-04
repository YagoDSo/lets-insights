import Parser from 'rss-parser';

// User-Agent de browser real: alguns portais (ex.: mobilidade.estadao.com.br)
// devolvem 403 pra User-Agent de bot identificado, mas 200 pra este.
const parser = new Parser({
  timeout: 20000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  },
});

// Lê vários feeds em paralelo. Equivale aos 9 nós RSS com continueOnFail:
// um feed que falha NÃO derruba a coleta — retorna [] e segue.
export async function lerFeeds(feeds) {
  const resultados = await Promise.all(
    feeds.map(async (f) => {
      try {
        const feed = await parser.parseURL(f.url);
        return (feed.items || []).map((it) => ({
          title: it.title,
          link: it.link,
          pubDate: it.pubDate || it.isoDate,
          isoDate: it.isoDate,
          contentSnippet: it.contentSnippet,
          content: it.content || it['content:encoded'],
          description: it.summary || it.description,
          creator: it.creator || it['dc:creator'],
        }));
      } catch (e) {
        console.log(`⚠️ Feed falhou (${f.url}): ${e.message}`);
        return [];
      }
    }),
  );
  return resultados.flat();
}
