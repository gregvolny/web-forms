import type { XFormsElement } from '@getodk/common/test/fixtures/xform-dsl/XFormsElement.ts';
import type { AnyNode, RootNode } from '@getodk/xforms-engine';
import type { Accessor, Setter } from 'solid-js';
import { createMemo, createSignal, runWithOwner } from 'solid-js';
import { afterEach, expect } from 'vitest';
import type { ComparableAnswer } from '../answer/ComparableAnswer.ts';
import { answerOf } from '../client/answerOf.ts';
import type { TestFormResource } from '../client/init.ts';
import { initializeTestForm } from '../client/init.ts';
import { getClosestRepeatRange } from '../client/traversal.ts';
import { UnclearApplicabilityError } from '../error/UnclearApplicabilityError.ts';
import { PositionalEvent } from './event/PositionalEvent.ts';
import { RepeatInstanceEvent } from './event/RepeatInstanceEvent.ts';
import {
	getPositionalEvents,
	type AnyPositionalEvent,
	type NonTerminalPositionalEvent,
	type PositionalEvents,
} from './event/getPositionalEvents.ts';
import { TreeReference } from './instance/TreeReference.ts';
import type { PathResource } from './resource/PathResource.ts';
import { r } from './resource/ResourcePathHelper.ts';
import { SelectChoiceList } from './select/SelectChoiceList.ts';

interface ScenarioConstructorOptions {
	readonly dispose: VoidFunction;
	readonly formName: string;
	readonly instanceRoot: RootNode;
}

type FormFileName = `${string}.xml`;

const isFormFileName = (value: PathResource | string): value is FormFileName => {
	return typeof value === 'string' && value.endsWith('.xml');
};

// prettier-ignore
type ScenarioStaticInitParameters =
	| readonly [formFileName: FormFileName]
	| readonly [formName: string, form: XFormsElement]
	| readonly [resource: PathResource];

/**
 * @see {@link Scenario.createNewRepeat} for details
 */
interface CreateNewRepeatAssertedReferenceOptions {
	readonly assertCurrentReference: string;
}

export class Scenario {
	static async init(...args: ScenarioStaticInitParameters): Promise<Scenario> {
		let resource: TestFormResource;
		let formName: string;

		if (isFormFileName(args[0])) {
			return Scenario.init(r(args[0]));
		} else if (args.length === 1) {
			const [pathResource] = args;
			resource = pathResource;
			formName = pathResource.formName;
		} else {
			const [name, form] = args;

			formName = name;
			resource = form;
		}

		const { dispose, owner, instanceRoot } = await initializeTestForm(resource);

		await new Promise((resolve) => {
			setTimeout(resolve, 1);
		});

		return runWithOwner(owner, () => {
			return new this({
				dispose,
				formName,
				instanceRoot,
			});
		})!;
	}

	readonly formName: string;
	readonly instanceRoot: RootNode;

	private readonly getPositionalEvents: Accessor<PositionalEvents>;
	private readonly setEventPosition: Setter<number>;
	private readonly getSelectedPositionalEvent: Accessor<AnyPositionalEvent>;

	private constructor(options: ScenarioConstructorOptions) {
		const { dispose, formName, instanceRoot } = options;

		this.formName = formName;
		this.instanceRoot = instanceRoot;

		const [eventPosition, setEventPosition] = createSignal(0);

		this.getPositionalEvents = () => getPositionalEvents(instanceRoot);
		this.setEventPosition = setEventPosition;

		this.getSelectedPositionalEvent = createMemo(() => {
			const events = getPositionalEvents(instanceRoot);
			const position = eventPosition();
			const event = events[position];

			if (event == null) {
				throw new Error(`No question at position: ${position}`);
			}

			return event;
		});

		afterEach(() => {
			PositionalEvent.cleanup();
			dispose();
		});
	}

	private assertNonTerminalEventSelected(
		event: AnyPositionalEvent
	): asserts event is NonTerminalPositionalEvent {
		expect(event.eventType).not.toBe('BEGINNING_OF_FORM');
		expect(event.eventType).not.toBe('END_OF_FORM');
	}

	private assertNodeset(
		event: AnyPositionalEvent,
		nodeset: string
	): asserts event is NonTerminalPositionalEvent {
		this.assertNonTerminalEventSelected(event);

		expect(event.node.definition.nodeset).toBe(nodeset);
	}

	private assertReference(
		question: AnyPositionalEvent,
		reference: string
	): asserts question is NonTerminalPositionalEvent {
		this.assertNonTerminalEventSelected(question);

		expect(question.node.currentState.reference).toBe(reference);
	}

	private setNonTerminalEventPosition(
		callback: (current: number) => number,
		expectReference: string
	): NonTerminalPositionalEvent {
		this.setEventPosition(callback);

		const event = this.getSelectedPositionalEvent();

		this.assertNonTerminalEventSelected(event);

		if (expectReference != null) {
			this.assertReference(event, expectReference);
		}

		return event;
	}

	next(expectReference: string): NonTerminalPositionalEvent {
		const increment = (current: number): number => current + 1;

		return this.setNonTerminalEventPosition(increment, expectReference);
	}

	private setPositionalStateToReference(reference: string): AnyPositionalEvent {
		const events = this.getPositionalEvents();
		const index = events.findIndex(({ node }) => {
			return node?.currentState.reference === reference;
		});

		if (index === -1) {
			throw new Error(
				`Setting answer to ${reference} failed: could not locate question/positional event with that reference.`
			);
		}

		return this.setNonTerminalEventPosition(() => index, reference);
	}

	answer(reference: string, value: unknown): unknown;
	answer(value: unknown): unknown;
	answer(...[arg0, arg1]: [reference: string, value: unknown] | [value: unknown]): unknown {
		let event: AnyPositionalEvent;
		let value: unknown;

		if (arg1 === undefined) {
			event = this.getSelectedPositionalEvent();
			value = arg0;
		} else if (typeof arg0 === 'string') {
			const reference = arg0;

			event = this.setPositionalStateToReference(reference);
			value = arg1;
		} else {
			throw new Error('Unsupported `answer` overload call');
		}

		if (event.eventType === 'BEGINNING_OF_FORM') {
			throw new Error('Cannot answer question, beginning of form is selected');
		}

		if (event.eventType === 'END_OF_FORM') {
			throw new Error('Cannot answer question, end of form is selected');
		}

		if (event.eventType !== 'QUESTION') {
			throw new Error(`Cannot answer question of type ${event.node.definition.type}`);
		}

		event.answerQuestion(value);

		return;
	}

	answerOf(reference: string): ComparableAnswer {
		return answerOf(this.instanceRoot, reference);
	}

	choicesOf(reference: string): SelectChoiceList {
		const events = this.getPositionalEvents();
		// TODO: generalize more lookups...
		const event = events.find(({ node }) => {
			return node?.currentState.reference === reference;
		});

		if (event == null || event.eventType !== 'QUESTION' || event.node.nodeType !== 'select') {
			throw new Error(`No choices for reference: ${reference}`);
		}

		const { node } = event;

		return new SelectChoiceList(node);
	}

	/**
	 * Note: In JavaRosa, {@link Scenario.createNewRepeat} accepts either:
	 *
	 * - a nodeset reference, specifying where to create a new repeat instance
	 *   (regardless of the current positional state within the form)
	 * - no parameter, implicitly creating a repeat instance at the current form
	 *   positional state (presumably resulting in test failure if the positional
	 *   state does not allow this)
	 *
	 * When we began porting JavaRosa tests, we agreed to make certain aspects of
	 * positional state more explicit, by passing the **expected** nodeset
	 * reference as a parameter to methods which would either mutate that state,
	 * or invoke any behavior which would be (implicitly) based on its current
	 * positional state. The idea was that this would both improve clarity of
	 * intent (inlining meta-information into a test's body about that test's
	 * state as it progresses) and somewhat improve resilience against regressions
	 * (by treating such reference parameters _as assertions_).
	 *
	 * We still consider these changes valuable, but it turned out that the way
	 * they were originally conceived conflicts with (at least) the current
	 * {@link Scenario.createNewRepeat} interface in JavaRosa. As such, that
	 * method's interface is revised again so that:
	 *
	 * - JavaRosa tests which **already pass** a nodeset reference preserve the
	 *   same semantics and behavior they currently have
	 * - Web forms tests introducing the clarifying/current-state-asserting
	 *   behavior need to be slightly more explicit, by passing an options object
	 *   to disambiguate the reference nodeset's intent
	 */
	createNewRepeat(
		assertionOptionsOrTargetReference: CreateNewRepeatAssertedReferenceOptions | string
	): unknown {
		let repeatReference: string;
		let event: AnyPositionalEvent;

		if (typeof assertionOptionsOrTargetReference === 'object') {
			const options = assertionOptionsOrTargetReference;
			const { assertCurrentReference } = options;

			event = this.getSelectedPositionalEvent();

			this.assertNodeset(event, assertCurrentReference);

			repeatReference = assertCurrentReference;
		} else {
			repeatReference = assertionOptionsOrTargetReference;

			event = this.setPositionalStateToReference(repeatReference);
		}

		if (event.eventType !== 'PROMPT_NEW_REPEAT') {
			throw new Error('Cannot create new repeat, ');
		}

		const { node } = event;
		const { reference } = node.currentState;
		const repeatRange = getClosestRepeatRange(reference, node);

		if (repeatRange == null) {
			throw new Error(`Failed to find closest repeat range to node with reference: ${reference}`);
		}

		repeatRange.addInstances();

		const instances = repeatRange.currentState.children;
		const instance = instances[instances.length - 1]!;
		const instanceQuestion = RepeatInstanceEvent.from(instance);
		const index = this.getPositionalEvents().indexOf(instanceQuestion);

		this.setNonTerminalEventPosition(() => index, instance.currentState.reference);

		return;
	}

	/**
	 * Per JavaRosa:
	 *
	 * Removes the repeat instance corresponding to the provided reference
	 */
	removeRepeat(repeatNodeset: string): Scenario {
		const events = this.getPositionalEvents();
		const index = events.findIndex(({ node }) => {
			return node?.currentState.reference === repeatNodeset;
		});

		// TODO: should we inherit JavaRosa's messaging ("Please add some field
		// and a form control")?
		if (index === -1) {
			throw new Error(
				`Removing repeat instance with nodeset ${repeatNodeset} failed: could not locate repeat instance with that reference.`
			);
		}

		const event = this.setNonTerminalEventPosition(() => index, repeatNodeset);

		if (event.node.nodeType !== 'repeat-instance') {
			throw new Error('Not a repeat instance');
		}

		const repeatRange = getClosestRepeatRange(repeatNodeset, event.node);

		if (repeatRange == null) {
			throw new Error('Cannot remove repeat instance, failed to find its parent repeat range');
		}

		const repeatIndex = repeatRange.currentState.children.indexOf(event.node);

		if (repeatIndex === -1) {
			throw new Error('Cannot remove repeat, not in range');
		}

		repeatRange.removeInstances(repeatIndex);

		return this;
	}

	setLanguage(languageName: string): void {
		const { instanceRoot } = this;

		const language = instanceRoot.languages.find((formLanguage) => {
			return formLanguage.language === languageName;
		});

		if (language == null || language.isSyntheticDefault) {
			throw new Error(`Form does not support language: ${languageName}`);
		}

		this.instanceRoot.setLanguage(language);
	}

	refAtIndex(): TreeReference {
		const event = this.getSelectedPositionalEvent();

		let treeReferenceNode: AnyNode;

		if (event.eventType === 'END_OF_FORM') {
			treeReferenceNode = this.instanceRoot;
		} else {
			treeReferenceNode = event.node;
		}

		return new TreeReference(treeReferenceNode);
	}

	/**
	 * @todo it is not clear if/how we'll use similar logic in web forms. It
	 * seems most likely to be applicable to offline capabilities.
	 */
	serializeAndDeserializeForm(): Promise<Scenario> {
		return Promise.reject(new UnclearApplicabilityError('serialization/deserialization'));
	}
}
