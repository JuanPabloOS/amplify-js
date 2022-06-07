import { CognitoIdentityProviderClientConfig } from '@aws-sdk/client-cognito-identity-provider';
import {
	createMachine,
	MachineConfig,
	EventFrom,
	assign,
	sendParent,
} from 'xstate';
import { createModel } from 'xstate/lib/model';
import { CognitoService } from '../serviceClass';
import { CognitoProviderConfig } from '../CognitoProvider';
import { SignUpResult } from '../../../types/AuthPluggable';

// TODO: what should we store here?
interface SignUpMachineContext {
	service: CognitoService | null;
	authConfig: CognitoProviderConfig;
	clientConfig: CognitoIdentityProviderClientConfig;
	username: string;
	password: string;
	attributes?: object;
	validationData?: { [key: string]: any };
	clientMetadata?: { [key: string]: string };
	error?: any; // TODO: should this be a proper error type?
	signUpResult?: SignUpResult | null;
}

type SignUpMachineTypestate =
	| { value: 'notStarted'; context: SignUpMachineContext }
	| {
			value: 'initiatingSigningUp';
			context: SignUpMachineContext;
	  }
	| {
			value: 'signedUp';
			context: SignUpMachineContext;
	  }
	| {
			value: 'error';
			context: SignUpMachineContext & { error: any };
	  }
	| { value: 'confirmingSignUp'; context: SignUpMachineContext }
	| {
			value: 'respondingToConfirmSignUp';
			context: SignUpMachineContext & { confirmationCode: string };
	  };

export const signUpMachineModel = createModel(
	{
		clientConfig: {},
		authConfig: {
			userPoolId: '',
			clientId: '',
			region: '',
		},
		username: '',
		password: '',
		attributes: {},
		validationData: {},
		clientMetadata: {},
		service: null,
	} as SignUpMachineContext,
	{
		events: {
			confirmSignUp: (params: { confirmationCode: string }) => ({
				params,
			}),
		},
	}
);

type SignUpMachineEvents = EventFrom<typeof signUpMachineModel>;

const signUpStateMachine: MachineConfig<
	SignUpMachineContext,
	any,
	SignUpMachineEvents
> = {
	context: {
		service: null,
		authConfig: {
			userPoolId: '',
			clientId: '',
			// hardcoded
			region: 'us-west-2',
		},
		clientConfig: {},
		username: '',
		password: '',
		attributes: {},
		validationData: {},
		clientMetadata: {},
		error: undefined,
		signUpResult: null,
	},
	id: 'signUpState',
	initial: 'notStarted',
	states: {
		notStarted: {
			entry: (_context, _event) => {
				console.log('Sign up machine has been spawned!', {
					_context,
					_event,
				});
			},
			always: {
				target: 'initiatingSigningUp',
			},
		},
		initiatingSigningUp: {
			invoke: {
				src: async (context, _event) => {
					try {
						const res = await context.service?.signUp({
							username: context.username,
							password: context.password,
							attributes: context.attributes,
							validationData: context.validationData,
							clientMetadata: context.clientMetadata,
							clientId: context.authConfig.clientId,
						});
						console.log('signUpMachine 97!!!', { res });
						// TODO: ask James about this
						// if (res && typeof res.AuthenticationResult !== 'undefined') {
						// 	cacheInitiateAuthResult(res, context.userStorage);
						// }
						return res;
					} catch (err) {
						console.error('initiatingSigningUp error: ', err);
						throw err;
					}
				},
				id: 'InitiateSignUp',
				onDone: [
					{
						actions: assign((_context, event) => ({
							signUpResult: { ...event.data },
						})),
						cond: 'needsConfirmation',
						target: 'confirmingSignUp',
					},
					{
						target: 'signedUp',
					},
				],
				onError: [
					{
						actions: assign({ error: (_context, event) => event.data }),
						target: 'error',
					},
				],
			},
		},
		confirmingSignUp: {
			on: {
				confirmSignUp: {
					target: 'respondingToConfirmSignUp',
				},
			},
		},
		respondingToConfirmSignUp: {
			invoke: {
				src: async (context, event) => {
					try {
						const res = await context.service?.confirmSignUp({
							clientId: context.authConfig.clientId,
							confirmationCode: event.params.confirmationCode,
							username: context.username,
						});
						console.log('respondingToConfirmSignUp', { res });
						return res;
					} catch (err) {
						console.error('respondingToConfirmSignUp error: ', err);
						throw err;
					}
				},
				onDone: [
					{
						target: 'signedUp',
					},
				],
				onError: [
					{
						target: 'error',
					},
				],
			},
		},
		signedUp: {
			type: 'final',
		},
		error: {
			entry: 'sendErrorToParent',
			type: 'final',
		},
	},
};

export const signUpMachine = createMachine<
	SignUpMachineContext,
	SignUpMachineEvents,
	SignUpMachineTypestate
>(signUpStateMachine, {
	actions: {
		sendErrorToParent: sendParent((context, _event) => ({
			type: 'error',
			error: context.error,
		})),
	},
	guards: {
		needsConfirmation: (_context, event) => {
			console.log(
				{ _context, event },
				// @ts-ignore
				`needsConfirmation: ${event.data.UserConfirmed === false}`
			);
			// @ts-ignore
			return event.data.UserConfirmed === false;
		},
	},
});

export const signUpMachineEvents = signUpMachineModel.events;
