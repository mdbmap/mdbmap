import { useCallback, useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import {
	Button,
	Dialog,
	DialogTrigger,
	Form,
	Heading,
	Input,
	Label,
	Modal,
	ModalOverlay,
	TextField,
} from "react-aria-components";

import { startAuthAttempt } from "./auth-attempt.ts";
import type { AuthFields, AuthMode } from "./submit-auth.ts";

const COPY = {
	createAccount: "Create account",
	email: "Email",
	haveAccount: "Already have an account? Sign in",
	name: "Name",
	needAccount: "Need an account? Create one",
	password: "Password",
	signIn: "Sign in",
	submitting: "Working…",
} as const;

const emptyFields = (): AuthFields => ({
	email: "",
	name: "",
	password: "",
});

interface FieldProps {
	autoComplete: string;
	label: string;
	name: string;
	onChange: (value: string) => void;
	type: "email" | "password" | "text";
	value: string;
}

function AuthField({
	autoComplete,
	label,
	name,
	onChange,
	type,
	value,
}: FieldProps) {
	return (
		<TextField
			isRequired
			name={name}
			onChange={onChange}
			type={type}
			value={value}
		>
			<Label>{label}</Label>
			<Input autoComplete={autoComplete} />
		</TextField>
	);
}

interface AuthFormFieldsProps {
	fields: AuthFields;
	isSignUp: boolean;
	onEmail: (value: string) => void;
	onName: (value: string) => void;
	onPassword: (value: string) => void;
}

function AuthFormFields({
	fields,
	isSignUp,
	onEmail,
	onName,
	onPassword,
}: AuthFormFieldsProps) {
	return (
		<>
			{isSignUp ? (
				<AuthField
					autoComplete="name"
					label={COPY.name}
					name="name"
					onChange={onName}
					type="text"
					value={fields.name}
				/>
			) : undefined}
			<AuthField
				autoComplete="email"
				label={COPY.email}
				name="email"
				onChange={onEmail}
				type="email"
				value={fields.email}
			/>
			<AuthField
				autoComplete={isSignUp ? "new-password" : "current-password"}
				label={COPY.password}
				name="password"
				onChange={onPassword}
				type="password"
				value={fields.password}
			/>
		</>
	);
}

function useAuthFields() {
	const [fields, setFields] = useState<AuthFields>(emptyFields);
	const handleEmail = useCallback((email: string) => {
		setFields((current) => ({ ...current, email }));
	}, []);
	const handleName = useCallback((name: string) => {
		setFields((current) => ({ ...current, name }));
	}, []);
	const handlePassword = useCallback((password: string) => {
		setFields((current) => ({ ...current, password }));
	}, []);
	const resetFields = useCallback(() => {
		setFields(emptyFields());
	}, []);
	return { fields, handleEmail, handleName, handlePassword, resetFields };
}

interface AuthDialogViewProps {
	error: string | undefined;
	fields: AuthFields;
	handleEmail: (value: string) => void;
	handleName: (value: string) => void;
	handlePassword: (value: string) => void;
	handleSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
	handleToggleMode: () => void;
	heading: string;
	isSignUp: boolean;
	pending: boolean;
	switchLabel: string;
}

function AuthDialogView({
	error,
	fields,
	handleEmail,
	handleName,
	handlePassword,
	handleSubmit,
	handleToggleMode,
	heading,
	isSignUp,
	pending,
	switchLabel,
}: AuthDialogViewProps) {
	return (
		<>
			<Heading slot="title">{heading}</Heading>
			{error === undefined ? undefined : <div role="alert">{error}</div>}
			<Form onSubmit={handleSubmit}>
				<AuthFormFields
					fields={fields}
					isSignUp={isSignUp}
					onEmail={handleEmail}
					onName={handleName}
					onPassword={handlePassword}
				/>
				<Button data-variant="primary" isDisabled={pending} type="submit">
					{pending ? COPY.submitting : heading}
				</Button>
			</Form>
			<button
				data-auth-switch
				disabled={pending}
				type="button"
				onClick={handleToggleMode}
			>
				{switchLabel}
			</button>
		</>
	);
}

interface AuthDialogFormProps {
	close: () => void;
}

function useAliveRef() {
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	return alive;
}

function AuthDialogForm({ close }: AuthDialogFormProps) {
	const [mode, setMode] = useState<AuthMode>("sign-in");
	const [error, setError] = useState<string | undefined>();
	const [pending, setPending] = useState(false);
	const inFlight = useRef(false);
	const mounted = useAliveRef();
	const { fields, handleEmail, handleName, handlePassword, resetFields } =
		useAuthFields();

	const handleToggleMode = useCallback(() => {
		setError(undefined);
		setMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"));
	}, []);

	const handleSubmit = useCallback(
		(event: SyntheticEvent<HTMLFormElement>) => {
			event.preventDefault();
			startAuthAttempt({
				close,
				fields,
				inFlight,
				mode,
				mounted,
				resetFields,
				setError,
				setPending,
			});
		},
		[close, fields, inFlight, mode, mounted, resetFields],
	);

	return (
		<AuthDialogView
			error={error}
			fields={fields}
			handleEmail={handleEmail}
			handleName={handleName}
			handlePassword={handlePassword}
			handleSubmit={handleSubmit}
			handleToggleMode={handleToggleMode}
			heading={mode === "sign-up" ? COPY.createAccount : COPY.signIn}
			isSignUp={mode === "sign-up"}
			pending={pending}
			switchLabel={mode === "sign-up" ? COPY.haveAccount : COPY.needAccount}
		/>
	);
}

function AuthDialogPanel() {
	return <Dialog>{({ close }) => <AuthDialogForm close={close} />}</Dialog>;
}

function AuthModal() {
	return (
		<Modal>
			<AuthDialogPanel />
		</Modal>
	);
}

type AuthTriggerVariant = "hero" | "inline";

function AuthTrigger({
	label,
	variant,
}: {
	label: string;
	variant: AuthTriggerVariant;
}) {
	if (variant === "hero") {
		return <Button data-cta>{label}</Button>;
	}
	return <Button data-auth-trigger>{label}</Button>;
}

interface AuthDialogProps {
	defaultOpen?: boolean;
	label?: string;
	variant?: AuthTriggerVariant;
}

function AuthDialog({
	defaultOpen = false,
	label = COPY.signIn,
	variant = "inline",
}: AuthDialogProps) {
	return (
		<DialogTrigger defaultOpen={defaultOpen}>
			<AuthTrigger label={label} variant={variant} />
			<ModalOverlay data-auth-dialog isDismissable>
				<AuthModal />
			</ModalOverlay>
		</DialogTrigger>
	);
}

export { AuthDialog };
