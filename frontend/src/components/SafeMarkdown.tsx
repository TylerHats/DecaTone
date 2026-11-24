import React from 'react';

export const OPEN_SOURCE_LICENSES_MARKDOWN = `# Open-Source Licenses & Attributions

## DecaTone Core License — GNU General Public License v3.0 (GPL-3.0)

DecaTone (Backend Switchboard, Web Frontend, and ESP32-S3 Rotary Phone Firmware) is free and open-source software licensed under the **GNU General Public License v3.0 (GPL-3.0-only)**.

- You are free to run, study, share, and modify the software under the terms of the GNU GPL v3.0.
- Any distributed modifications or derivative works must remain licensed under the GNU GPL v3.0 with complete corresponding source code made available.
- This software is distributed **WITHOUT ANY WARRANTY**, without even the implied warranty of **MERCHANTABILITY** or **FITNESS FOR A PARTICULAR PURPOSE**, and **WITHOUT EMERGENCY (911/E911) CALLING CAPABILITY**.
- Full license text: [https://www.gnu.org/licenses/gpl-3.0.html](https://www.gnu.org/licenses/gpl-3.0.html)

---

## Third-Party Open-Source Software & Services

DecaTone builds upon the following open-source libraries, runtimes, and community data providers:

- **React & React Router** — Copyright (c) Meta Platforms, Inc. and affiliates & Remix Software Inc. Licensed under the **MIT License** ([https://react.dev](https://react.dev)).
- **Express** — Copyright (c) OpenJS Foundation and contributors. Licensed under the **MIT License** ([https://expressjs.com](https://expressjs.com)).
- **SQLite3 & node-sqlite3** — Public Domain (SQLite core) and **BSD-3-Clause License** (Node bindings, TryGhost / MapBox) ([https://www.sqlite.org](https://www.sqlite.org)).
- **ws (WebSockets for Node.js)** — Copyright (c) Einar Otto Stangvik and contributors. Licensed under the **MIT License** ([https://github.com/websockets/ws](https://github.com/websockets/ws)).
- **Piper TTS / eSpeak-NG** — Local neural text-to-speech engine by Rhasspy / Open Home Foundation (**MIT License**) with phonemization data from **eSpeak-NG** (**GPL-3.0 License**) ([https://github.com/rhasspy/piper](https://github.com/rhasspy/piper)).
- **Open-Meteo Weather API** — Weather forecast data for service line \`711\` provided by Open-Meteo under **CC BY 4.0** attribution ([https://open-meteo.com](https://open-meteo.com)).
- **ESP-IDF / ArduinoJson** — Espressif IoT Development Framework (**Apache License 2.0**, Espressif Systems) and **ArduinoJson** by Benoit Blanchon (**MIT License**) ([https://arduinojson.org](https://arduinojson.org)).
- **Lucide Icons** — Copyright (c) Lucide Contributors. Licensed under the **ISC License** ([https://lucide.dev](https://lucide.dev)).
`;

function renderInlineNodes(text: string, keyPrefix: string): React.ReactNode[] {
  // Tokenize **bold**, `code`, and [label](https://...) links safely without dangerouslySetInnerHTML
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\))/g;
  const parts = text.split(pattern);
  const nodes: React.ReactNode[] = [];

  parts.forEach((part, idx) => {
    if (!part) return;
    const key = `${keyPrefix}-${idx}`;

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      nodes.push(
        <strong key={key} style={{ color: '#f8fafc', fontWeight: 700 }}>
          {part.slice(2, -2)}
        </strong>
      );
      return;
    }

    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      nodes.push(
        <code
          key={key}
          style={{
            fontFamily: 'var(--font-mono)',
            background: 'rgba(255, 255, 255, 0.08)',
            padding: '0.1rem 0.35rem',
            borderRadius: '4px',
            fontSize: '0.85em',
            color: 'var(--accent-amber)'
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
      return;
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)$/);
    if (linkMatch) {
      const [, label, href] = linkMatch;
      const isExternal = href.startsWith('http://') || href.startsWith('https://');
      nodes.push(
        <a
          key={key}
          href={href}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
          style={{ color: 'var(--accent-cyan)', textDecoration: 'underline' }}
        >
          {label}
        </a>
      );
      return;
    }

    nodes.push(<React.Fragment key={key}>{part}</React.Fragment>);
  });

  return nodes;
}

export const SafeMarkdown: React.FC<{ content: string }> = ({ content }) => {
  if (!content || !content.trim()) {
    return (
      <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
        No document content available.
      </p>
    );
  }

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let paragraphLines: string[] = [];

  const flushList = (idx: number) => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul
        key={`ul-${idx}`}
        style={{
          margin: '0.5rem 0 1rem 1.25rem',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem'
        }}
      >
        {listItems.map((item, itemIdx) => (
          <li key={`li-${idx}-${itemIdx}`} style={{ color: 'var(--text-main)', lineHeight: 1.65 }}>
            {renderInlineNodes(item, `li-${idx}-${itemIdx}`)}
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  const flushParagraph = (idx: number) => {
    if (paragraphLines.length === 0) return;
    const joined = paragraphLines.join(' ');
    blocks.push(
      <p key={`p-${idx}`} style={{ margin: '0 0 0.85rem 0', lineHeight: 1.7, color: 'var(--text-main)' }}>
        {renderInlineNodes(joined, `p-${idx}`)}
      </p>
    );
    paragraphLines = [];
  };

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushList(idx);
      flushParagraph(idx);
      return;
    }

    if (trimmed === '---' || trimmed === '***') {
      flushList(idx);
      flushParagraph(idx);
      blocks.push(
        <hr
          key={`hr-${idx}`}
          style={{
            border: 'none',
            borderTop: '1px solid var(--border-subtle)',
            margin: '1.25rem 0'
          }}
        />
      );
      return;
    }

    if (trimmed.startsWith('### ')) {
      flushList(idx);
      flushParagraph(idx);
      blocks.push(
        <h3
          key={`h3-${idx}`}
          style={{
            fontSize: '1.05rem',
            fontWeight: 700,
            color: '#f8fafc',
            margin: '1.1rem 0 0.45rem 0'
          }}
        >
          {renderInlineNodes(trimmed.slice(4), `h3-${idx}`)}
        </h3>
      );
      return;
    }

    if (trimmed.startsWith('## ')) {
      flushList(idx);
      flushParagraph(idx);
      blocks.push(
        <h2
          key={`h2-${idx}`}
          style={{
            fontSize: '1.2rem',
            fontWeight: 700,
            color: '#f8fafc',
            margin: '1.35rem 0 0.55rem 0'
          }}
        >
          {renderInlineNodes(trimmed.slice(3), `h2-${idx}`)}
        </h2>
      );
      return;
    }

    if (trimmed.startsWith('# ')) {
      flushList(idx);
      flushParagraph(idx);
      blocks.push(
        <h1
          key={`h1-${idx}`}
          style={{
            fontSize: '1.45rem',
            fontWeight: 800,
            color: '#fff',
            margin: '0.25rem 0 0.85rem 0'
          }}
        >
          {renderInlineNodes(trimmed.slice(2), `h1-${idx}`)}
        </h1>
      );
      return;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      flushParagraph(idx);
      listItems.push(trimmed.slice(2));
      return;
    }

    flushList(idx);
    paragraphLines.push(trimmed);
  });

  flushList(lines.length);
  flushParagraph(lines.length + 1);

  return <div>{blocks}</div>;
};
