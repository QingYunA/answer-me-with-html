// The steps block: it links the diagram and the code block of one panel (src/steps-panel.js puts the pair together). This file holds
// what the block says about itself. It draws nothing on its own: where no pair can be made, such as inside an ask option, it is an error.
import { ComponentError } from './error.js';

export default {
  name: 'steps',
  summary: 'Link a diagram and a code block: click an item, see its lines and note',
  syntax: `\`\`\`steps
<item> <line or range>: <note>
\`\`\`
- Put it in a panel with one code block and one flow, state or tree diagram. The block draws nothing itself: it ties the two together, and the pair takes the place of whichever of the two you wrote first.
- <item> is the text of an item in the diagram, exactly as the diagram writes it (a flow node, a state, a tree entry). The lines are the last number or the range before the colon, N or N-M. The note is one short sentence. The first colon ends the item, so an item cannot hold a colon: to link a tree entry such as "Part 1: Writing rules", rename that entry in the diagram so it has no colon. Spaces around the dash of a range are fine (1 - 2).
- Line numbers are the ones the code block shows: the file's own numbers with src= and lines=, the numbers from start=, else from 1. A linked code block always shows its line numbers.
- The steps run in the order you write them. A diagram item with no step stays a plain item. Write no diagram, and the block is a step-by-step walkthrough of the code: the items are then just names for the steps.
- On the page a click on an item boxes its lines, shows its note above them and marks its edges; a click on a line number picks the step that covers the line; the bar above the pair has Previous, Next and the step count; the arrow keys move and Esc clears. Side by side from about 720px of width, stacked below it.
- In print, in a PNG or PDF and with no script, the page shows no bar and no boxes. Every step is numbered on its item and beside its first line, and a numbered list of the steps follows the pair.
- \`am render\` reports, with the draft line: an item that is not in the diagram or that matches more than one, the same item in two steps, a range outside the code block, two steps whose lines overlap, a panel with no code block or with more than one code block or diagram, a second steps block, an image in a step, an item that ends with "-", an item whose diagram entry holds a colon, a steps block inside an ask option, a diagram type that is not linked yet (er, class, sequence, timeline and chart), and a diff block.`,
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
