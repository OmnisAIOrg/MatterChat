import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation } from '@tanstack/react-query';

export const useSendForgotPassword = () => {
	const sendForgotPassword = useEndpoint('POST', '/v1/users.forgotPassword');
	// MATTERCHAT: surface hard failures (e.g. reset disabled, server error) to the user instead of
	// failing silently. The success case still shows the anti-enumeration callout, not a toast.
	const dispatchToastMessage = useToastMessageDispatch();

	return useMutation({
		mutationFn: sendForgotPassword,
		onError: (error) => {
			dispatchToastMessage({ type: 'error', message: error });
		},
	});
};
