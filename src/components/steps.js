// The steps block: it links the diagram and the code block of one panel, or a diagram and its explanations (src/steps-panel.js puts the pair together). This file holds
// what the block says about itself. It draws nothing on its own: where no pair can be made, such as inside an ask option, it is an error.
import { ComponentError } from './error.js';

export default {
  name: 'steps',
  summary: 'Link a diagram to a code block, or walk through it step by step with an explanation per step',
  syntax: `\`\`\`steps
<item> <line or range>: <note>
\`\`\`
- Two modes. With a code block in the panel, a step links an item to lines of the code (below). With a diagram and no code block, a step is an item and its explanation (explain mode, at the end). The block draws nothing itself: it ties the pieces together, and they take the place of whichever of them you wrote first.
- Code mode: put it in a panel with one code block and, optionally, one flow, state or tree diagram. <item> is the text of an item in the diagram, exactly as the diagram writes it (a flow node, a state, a tree entry). The lines are the last number or the range before the colon, N or N-M. The note is one short sentence. The first colon ends the item, so an item cannot hold a colon: to link a tree entry such as "Part 1: Writing rules", rename that entry in the diagram so it has no colon. Spaces around the dash of a range are fine (1 - 2).
- Line numbers are the ones the code block shows: the file's own numbers with src= and lines=, the numbers from start=, else from 1. A linked code block always shows its line numbers.
- The steps run in the order you write them. A diagram item with no step stays a plain item. Write no diagram, and the block is a step-by-step walkthrough of the code: the items are then just names for the steps.
- On the page a click on an item boxes its lines, shows its note above them and marks its edges; a click on a line number picks the step that covers the line; the bar above the pair has Previous, Next and the step count; the arrow keys move and Esc clears. Side by side from about 720px of width, stacked below it.
- In print, in a PNG or PDF and with no script, the page shows no bar and no boxes. Every step is numbered on its item and beside its first line, and a numbered list of the steps follows the pair.
- Explain mode: put it in a panel with one flow, state or tree diagram and no code block, and write each step as <item>: <explanation>. The item is everything before the first colon, with no line numbers, so it may end in a number ("Step 2: ..."). The explanation is one short sentence of inline Markdown, and may be empty. The pair is the diagram and a numbered list of the steps, in the order you wrote the diagram and the steps block. Explain mode example:

\`\`\`flow LR
Order -> Pay -> Ship
\`\`\`

\`\`\`steps
Order: The customer places the order.
Pay: The payment is taken.
Ship: The warehouse sends the parcel.
\`\`\`

- Explain mode on the page: the list stays beside the diagram; a click on an item or on a list entry, Enter or Space on either, the arrow keys, Previous and Next pick a step, which lights the item and its edges and marks its entry in the list. Esc clears. There is no note bar, because the list carries the explanation. Print, PNG, PDF and no script show the numbered badges on the diagram and the numbered list.
- \`am render\` reports, with the draft line: an item that is not in the diagram or that matches more than one, the same item in two steps, a range outside the code block, two steps whose lines overlap, a panel with neither a code block nor a diagram, a panel with more than one code block or diagram, a second steps block, an image in a step, an item that ends with "-" (code mode), an item whose diagram entry holds a colon, a steps block inside an ask option, a diagram type that is not linked yet (er, class, sequence, timeline and chart), and a diff block. In explain mode a step written with lines ("Item 3-4: ...") is an item that is not in the diagram, and the message says that a step has no line numbers there.`,
  example: '```steps\nUser 1-2: The user starts the request.\nGateway 3: The gateway checks it.\nService 4-5: The service does the work.\n```',
  // A whole panel for am help steps and the docs: a code block, a diagram and the steps that link them.
  specimen: '```js start=1\nconst request = receive(input);\nconst user = authenticate(request);\nconst result = await service.run(user);\nrespond(result);\n```\n\n```flow LR\nGateway -> Auth -> Service\n```\n\n```steps\nGateway 1: The request comes in.\nAuth 2: The user is checked.\nService 3-4: The service runs, then the answer goes back.\n```',
  panelOnly: true,
  pageOnly: true,
  pageOnlyReason: 'a video cannot click through steps',
  // The pair is made by src/steps-panel.js. A steps block that reaches this point stands where no pair can be made (an ask option).
  render() {
    throw new ComponentError('steps: a steps block links the code block and the diagram of its own panel; it cannot go inside another block such as an ask option', 0);
  },
};
