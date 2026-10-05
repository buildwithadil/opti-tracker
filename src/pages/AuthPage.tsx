import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { authApi } from '../lib/api'
import { newPasswordSchema } from '../lib/authValidation'
import { Button } from '../components/ui/Button'
import { Field, TextInput } from '../components/ui/Field'
import { ErrorState } from '../components/ui/States'

export function AuthPage() {
  const location = useLocation()
  const session = useQuery({ queryKey: ['session'], queryFn: authApi.session, retry: false })

  if (session.isPending) return <AuthLoadingScreen />
  if (session.isError) {
    return (
        <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-8">
        <ErrorState
          className="w-full max-w-md"
          title="Session service unavailable"
          description={session.error instanceof Error ? session.error.message : 'We could not check workspace access.'}
          onRetry={() => void session.refetch()}
        />
      </main>
    )
  }
  if (session.data.authenticated) return <Navigate to="/dashboard" replace />

  const isSetup = location.pathname === '/setup'
  if (isSetup && !session.data.setupRequired) return <Navigate to="/login" replace />
  if (!isSetup && session.data.setupRequired) return <Navigate to="/setup" replace />

  return <AuthForm key={isSetup ? 'setup' : 'login'} isSetup={isSetup} />
}

function AuthForm({ isSetup }: { isSetup: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [showPassword, setShowPassword] = useState(false)
  const schema = z.object({
    name: isSetup ? z.string().trim().min(2, 'Use at least 2 characters for your name.').max(200, 'Use no more than 200 characters.') : z.string(),
    email: z.string().trim().email('Enter a valid email address.').max(254, 'Use no more than 254 characters.'),
    password: isSetup ? newPasswordSchema : z.string().min(1, 'Enter your password.').max(256, 'Use no more than 256 characters.'),
    confirmation: z.string(),
    setupToken: isSetup ? z.string().min(16, 'Enter the setup secret (16–256 characters).').max(256, 'Use no more than 256 characters.') : z.string(),
  }).refine((values) => !isSetup || values.password === values.confirmation, {
    message: 'Passwords must match.',
    path: ['confirmation'],
  })
  type AuthValues = z.infer<typeof schema>
  const form = useForm<AuthValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', confirmation: '', setupToken: '' },
  })
  const authMutation = useMutation({
    mutationFn: (values: AuthValues) => isSetup
      ? authApi.setup({ name: values.name, email: values.email, password: values.password, setupToken: values.setupToken })
      : authApi.login({ email: values.email, password: values.password }),
    onSuccess: async (session) => {
      await queryClient.cancelQueries()
      queryClient.clear()
      queryClient.setQueryData(['session'], session)
      form.reset()
      navigate('/dashboard', { replace: true })
    },
  })
  const errors = form.formState.errors
  const passwordChanged = location.state?.passwordChanged === true

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-8 sm:px-6">
      <section className="w-full max-w-md bg-white px-6 py-8 shadow-sm sm:px-9 sm:py-10" aria-labelledby="auth-title">
        <div className="mb-8 flex items-center gap-2.5"><span className="flex size-8 items-center justify-center rounded-[9px] bg-accent text-white"><span className="text-sm font-semibold">O</span></span><p className="text-sm font-semibold tracking-tight text-ink">OptiDesk</p></div>
        <h1 id="auth-title" className="text-[28px] font-semibold tracking-tight text-ink">{isSetup ? 'Set up administrator access' : 'Administrator sign in'}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          {isSetup ? 'Complete the one-time setup using the secret supplied by your deployment administrator.' : 'Use the administrator email address and password. Public registration is not available.'}
        </p>
        {passwordChanged ? <p className="mt-5 rounded-md border border-line p-3 text-sm text-ink" role="status">Your password was changed and all sessions were signed out. Sign in with your new password.</p> : null}
        {authMutation.isError ? <p className="mt-5 text-sm text-red-700" role="alert">{authMutation.error instanceof Error ? authMutation.error.message : 'Sign in could not be completed.'}</p> : null}

        <form className="mt-6 space-y-4" onSubmit={form.handleSubmit((values) => authMutation.mutate(values))} noValidate>
          <fieldset className="space-y-4 disabled:opacity-70" disabled={authMutation.isPending}>
            <legend className="sr-only">{isSetup ? 'Administrator setup details' : 'Sign in credentials'}</legend>
            {isSetup ? (
              <Field id="auth-name" label="Administrator name" error={errors.name?.message}>
                <TextInput id="auth-name" autoComplete="name" maxLength={100} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'auth-name-error' : undefined} {...form.register('name')} />
              </Field>
            ) : null}
            <Field id="auth-email" label="Email address" error={errors.email?.message}>
              <TextInput id="auth-email" type="email" autoComplete="username" maxLength={254} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'auth-email-error' : undefined} {...form.register('email')} />
            </Field>
            <Field id="auth-password" label="Password" hint={isSetup ? 'Use 12–256 characters.' : undefined} error={errors.password?.message}>
              <div className="relative">
                <TextInput id="auth-password" className="pr-12" type={showPassword ? 'text' : 'password'} autoComplete={isSetup ? 'new-password' : 'current-password'} minLength={isSetup ? 12 : undefined} maxLength={256} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'auth-password-error' : isSetup ? 'auth-password-hint' : undefined} {...form.register('password')} />
                <button type="button" className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-ink" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                  {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                </button>
              </div>
            </Field>
            {isSetup ? (
              <>
                <Field id="auth-confirmation" label="Confirm password" error={errors.confirmation?.message}>
                  <TextInput id="auth-confirmation" type="password" autoComplete="new-password" maxLength={256} aria-invalid={!!errors.confirmation} aria-describedby={errors.confirmation ? 'auth-confirmation-error' : undefined} {...form.register('confirmation')} />
                </Field>
                <Field id="auth-setup-token" label="Setup secret" hint="The deployment secret, not your account password. Use 16–256 characters." error={errors.setupToken?.message}>
                  <TextInput id="auth-setup-token" type="password" autoComplete="off" minLength={16} maxLength={256} spellCheck={false} aria-invalid={!!errors.setupToken} aria-describedby={errors.setupToken ? 'auth-setup-token-error' : 'auth-setup-token-hint'} {...form.register('setupToken')} />
                </Field>
              </>
            ) : null}
            <Button className="w-full" type="submit" loading={authMutation.isPending}>{isSetup ? 'Complete one-time setup' : 'Sign in'}</Button>
          </fieldset>
        </form>
        <p className="mt-7 border-t border-line pt-5 text-xs leading-5 text-muted">Your session is managed securely by the service.</p>
      </section>
    </main>
  )
}

export function AuthLoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center gap-3 bg-paper" role="status">
      <LoaderCircle className="size-5 animate-spin text-muted" aria-hidden="true" />
      <span className="text-sm text-muted">Checking workspace access…</span>
    </main>
  )
}
