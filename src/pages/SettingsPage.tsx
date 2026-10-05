import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { authApi, clearCsrfToken } from '../lib/api'
import { newPasswordSchema } from '../lib/authValidation'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { Field, TextInput } from '../components/ui/Field'
import { ErrorState, LoadingState } from '../components/ui/States'
import { PageHeader } from '../components/ui/PageHeader'
import { InvoiceIdentityForm } from '../components/InvoiceIdentityForm'

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(256, 'Use no more than 256 characters.'),
  newPassword: newPasswordSchema,
  confirmation: z.string(),
}).refine((values) => values.newPassword === values.confirmation, {
  message: 'Passwords must match.',
  path: ['confirmation'],
})
type PasswordValues = z.infer<typeof passwordSchema>

export function SettingsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const identity = useQuery({ queryKey: ['shop-identity'], queryFn: authApi.shopIdentity })
  const session = useQuery({ queryKey: ['session'], queryFn: authApi.session, retry: false })
  const administrator = session.data?.authenticated ? session.data : undefined
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmation: '' },
  })
  const changePassword = useMutation({
    mutationFn: (values: PasswordValues) => authApi.changePassword({ currentPassword: values.currentPassword, newPassword: values.newPassword }),
    onSuccess: async () => {
      await queryClient.cancelQueries()
      clearCsrfToken()
      queryClient.clear()
      form.reset()
      navigate('/login', { replace: true, state: { passwordChanged: true } })
    },
  })
  const errors = form.formState.errors

  return (
    <div className="space-y-7">
      <PageHeader title="Settings" description="Shop information and account security." />
      <Card>
        <CardHeader><CardTitle>Shop and administrator</CardTitle></CardHeader>
        <CardContent>
          {identity.isPending ? <LoadingState label="Loading shop identity…" /> : null}
          {identity.isError ? <ErrorState description={identity.error instanceof Error ? identity.error.message : 'The shop identity could not be loaded.'} onRetry={() => void identity.refetch()} /> : null}
          {identity.isSuccess ? (
            <>
              <dl className="space-y-4 text-sm sm:grid sm:grid-cols-[12rem_1fr] sm:gap-x-6 sm:gap-y-4 sm:space-y-0">
                <dt className="text-muted">Shop name</dt><dd className="break-words font-medium text-ink">{identity.data.shopName || 'Not configured yet'}</dd>
                <dt className="text-muted">Administrator name</dt><dd className="break-words font-medium text-ink">{administrator?.name}</dd>
                <dt className="text-muted">Administrator email</dt><dd className="break-words font-medium text-ink">{identity.data.administratorEmail}</dd>
              </dl>
            </>
          ) : null}
        </CardContent>
      </Card>
      <InvoiceIdentityForm />
      <Card>
        <CardHeader><CardTitle>Change password</CardTitle></CardHeader>
        <CardContent>
          <p id="password-change-description" className="mb-5 max-w-xl text-sm leading-6 text-muted">Use a password of 12–256 characters. Changing the password signs out all sessions, including this one.</p>
          <form className="max-w-md space-y-4" aria-describedby="password-change-description" onSubmit={form.handleSubmit((values) => changePassword.mutate(values))} noValidate>
            <fieldset className="space-y-4 disabled:opacity-70" disabled={changePassword.isPending}>
              <legend className="sr-only">Change administrator password</legend>
              <Field id="current-password" label="Current password" error={errors.currentPassword?.message}>
                <TextInput id="current-password" type="password" autoComplete="current-password" maxLength={256} aria-invalid={!!errors.currentPassword} aria-describedby={errors.currentPassword ? 'current-password-error' : undefined} {...form.register('currentPassword')} />
              </Field>
              <Field id="new-password" label="New password" error={errors.newPassword?.message}>
                <TextInput id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={256} aria-invalid={!!errors.newPassword} aria-describedby={errors.newPassword ? 'new-password-error' : undefined} {...form.register('newPassword')} />
              </Field>
              <Field id="password-confirmation" label="Confirm new password" error={errors.confirmation?.message}>
                <TextInput id="password-confirmation" type="password" autoComplete="new-password" maxLength={256} aria-invalid={!!errors.confirmation} aria-describedby={errors.confirmation ? 'password-confirmation-error' : undefined} {...form.register('confirmation')} />
              </Field>
              {changePassword.isError ? <p className="text-sm text-red-700" role="alert">{changePassword.error instanceof Error ? changePassword.error.message : 'Your password could not be changed.'}</p> : null}
              <Button type="submit" loading={changePassword.isPending}>Change password and sign out</Button>
            </fieldset>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
