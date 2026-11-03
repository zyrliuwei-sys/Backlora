import { parse, parseFragment, type DefaultTreeAdapterMap } from 'parse5';

import { BadgeBridgeError } from '@/lib/badge-bridge-policy';
import {
  badgeAttributes,
  validateFooterBadges,
  type FooterBadge,
} from '@/lib/footer-badge-data';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
const element = (node: Node): node is Element => 'tagName' in node;
const attrs = (node: Element) =>
  Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
const textOf = (node: Node): string =>
  'value' in node
    ? node.value
    : 'childNodes' in node
      ? node.childNodes.map(textOf).join('')
      : '';

function metadata(values: Record<string, string>, standard: string[]) {
  const extra: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (name === 'style') {
      if (
        value
          .split(';')
          .filter((v) => v.trim())
          .some(
            (v) =>
              !/^\s*(?:width|height|max-width|max-height)\s*:\s*(?:[0-9]+(?:px|%)?|auto)\s*$/i.test(
                v
              )
          )
      )
        throw new Error('Unsupported badge style');
    } else if (!standard.includes(name)) extra[name] = value;
  }
  return badgeAttributes(extra);
}

/** One official anchor per install; pasted code never executes. */
export function parseOfficialBadge(html: unknown): FooterBadge {
  try {
    if (typeof html !== 'string' || !html.trim() || html.length > 20_000)
      throw new Error();
    const nodes = parseFragment(html).childNodes.filter(
      (n) =>
        n.nodeName !== '#comment' &&
        !(n.nodeName === '#text' && !textOf(n).trim())
    );
    if (nodes.length !== 1 || !element(nodes[0]) || nodes[0].tagName !== 'a')
      throw new Error();
    const anchor = nodes[0];
    const a = attrs(anchor);
    if (a.target && !['_blank', '_self'].includes(a.target)) throw new Error();
    const children = anchor.childNodes.filter(element);
    if (children.length > 1 || children.some((n) => n.tagName !== 'img'))
      throw new Error();
    const img = children[0] ? attrs(children[0]) : undefined;
    const text = textOf(anchor).trim();
    const dimension = (name: 'width' | 'height') => {
      if (img?.[name] !== undefined) return Number(img[name]);
      const value = img?.style?.match(
        new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*(\\d+)px\\s*(?:;|$)`, 'i')
      )?.[1];
      return value ? Number(value) : undefined;
    };
    return validateFooterBadges([
      {
        href: a.href,
        src: img?.src,
        text: text || undefined,
        alt:
          img?.alt?.trim() ||
          text.slice(0, 120) ||
          a['aria-label'] ||
          a.title ||
          img?.title ||
          new URL(a.href).hostname,
        rel: a.rel,
        attributes: metadata(a, ['href', 'target', 'rel']),
        imageAttributes: img
          ? metadata(img, ['src', 'alt', 'width', 'height', 'loading'])
          : undefined,
        width: dimension('width'),
        height: dimension('height'),
      },
    ])[0];
  } catch {
    throw new BadgeBridgeError(
      'markup',
      'Unsupported badge HTML; supply one official HTTPS link with text or one image',
      400
    );
  }
}

/** Check actual parsed anchors, never a URL appearing only in script JSON. */
export function badgeIsPublic(
  html: string,
  badge: FooterBadge,
  pageUrl: string
) {
  const nodes: Node[] = [parse(html)];
  const matches = (
    got: Record<string, string>,
    needed?: Record<string, string>
  ) => Object.entries(needed ?? {}).every(([k, v]) => got[k] === v);
  while (nodes.length) {
    const node = nodes.pop()!;
    if (element(node)) {
      if (['script', 'style', 'template', 'noscript'].includes(node.tagName))
        continue;
      const values = attrs(node);
      if ('hidden' in values || values['aria-hidden'] === 'true') continue;
      if (node.tagName === 'a') {
        let href: string;
        try {
          href = new URL(values.href, pageUrl).href;
        } catch {
          continue;
        }
        const image = node.childNodes
          .filter(element)
          .find((n) => n.tagName === 'img');
        const imageValues = image ? attrs(image) : {};
        if (
          href === badge.href &&
          matches(values, badge.attributes) &&
          (!badge.text || textOf(node).trim() === badge.text) &&
          (!badge.src ||
            (imageValues.src === badge.src &&
              matches(imageValues, badge.imageAttributes)))
        )
          return true;
      }
    }
    if ('childNodes' in node) nodes.push(...node.childNodes);
  }
  return false;
}
