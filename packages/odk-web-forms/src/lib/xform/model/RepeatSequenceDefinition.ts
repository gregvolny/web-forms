import { RepeatGroupDefinition } from '../body/group/RepeatGroupDefinition.ts';
import type { BindDefinition } from './BindDefinition.ts';
import { DescendentNodeDefinition } from './DescendentNodeDefinition.ts';
import type { NodeDefinition, ParentNodeDefinition } from './NodeDefinition.ts';
import { RepeatInstanceDefinition } from './RepeatInstanceDefinition.ts';
import { RepeatTemplateDefinition } from './RepeatTemplateDefinition.ts';

export class RepeatSequenceDefinition
	extends DescendentNodeDefinition<'repeat-sequence', RepeatGroupDefinition>
	implements NodeDefinition<'repeat-sequence'>
{
	// TODO: if an implicit template is derived from an instance in a form
	// definition, should its default values (if any) be cleared? Probably!
	static createTemplateElement(instanceElement: Element): Element {
		return instanceElement.cloneNode(true) as Element;
	}

	static createInstanceElement(templateElement: Element): Element {
		return templateElement.cloneNode(true) as Element;
	}

	readonly type = 'repeat-sequence';

	readonly template: RepeatTemplateDefinition;
	readonly children = null;
	readonly instances: RepeatInstanceDefinition[];

	readonly node = null;
	readonly nodeName: string;
	readonly defaultValue = null;

	constructor(
		parent: ParentNodeDefinition,
		bind: BindDefinition,
		bodyElement: RepeatGroupDefinition,
		modelNodes: readonly [Element, ...Element[]]
	) {
		super(parent, bind, bodyElement);
		const { template, instanceNodes } = RepeatTemplateDefinition.parseModelNodes(this, modelNodes);

		this.template = template;
		this.nodeName = template.nodeName;
		this.instances = instanceNodes.map((element) => {
			return new RepeatInstanceDefinition(this, element);
		});
	}

	toJSON() {
		const { bind, bodyElement: groupDefinition, parent, root, ...rest } = this;

		return rest;
	}
}
