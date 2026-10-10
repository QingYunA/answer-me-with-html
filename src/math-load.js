/*! Temml (https://github.com/ronkok/Temml), bundled for math in prose. The MIT License (MIT), Copyright (c) 2020 Ron Kok.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject
 * to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
 * FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Temml carries two parts under the Apache License 2.0: its mhchem port (Copyright (c) 2011-2015 The MathJax Consortium, (c) 2015-2018
 * Martin Hensel) and a hyphenate and escape pair adapted from Facebook's React. http://www.apache.org/licenses/LICENSE-2.0
 */

// Loads Temml for a draft that may hold a formula. The import is dynamic, so a render without math (and am --version) never starts Temml's code:
// the bundle compiles it on first use (scripts/build.mjs). Render is synchronous, so the caller awaits this before renderDoc.
import { useTemml, mayHaveMath } from './math.js';

export async function loadMath(source) {
  if (!mayHaveMath(String(source))) return;
  useTemml((await import('temml')).default);
}
