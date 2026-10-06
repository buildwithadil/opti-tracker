import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router-dom'
import type { Invoice } from '../../shared/invoices'
import { paymentMethodLabels, paymentStatusLabels, type PaymentMethod } from '../../shared/payments'
import { asPaise, formatPaise } from '../../shared/money'
import { invoiceErrorMessage, invoiceKeys, invoicesApi, incompleteInvoice } from '../lib/invoices'
import { categoryLabel, purchaseMoney, purchaseKeys, purchasesApi } from '../lib/purchases'
import { customerKeys, customersApi } from '../lib/customers'
import { prescriptionDate } from '../lib/prescriptions'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/States'
import '../invoice.css'

export function InvoicePage() {
  const { uuid = '', purchaseUuid = '' } = useParams(), client = useQueryClient()
  const location=useLocation(), printed=useRef(false)
  const lock = useRef(false), submission = useRef(crypto.randomUUID())
  const invoice = useQuery({ queryKey: invoiceKeys.purchase(uuid, purchaseUuid), queryFn: ({ signal }) => invoicesApi.get(uuid, purchaseUuid, signal), retry: false })
  useEffect(()=>{ if (invoice.data && location.state?.printInvoice && !printed.current) { printed.current=true; void document.fonts.ready.then(()=>window.print()) } },[invoice.data,location.state])
  const needsGeneration = invoice.isSuccess && invoice.data === null
  const customer = useQuery({ queryKey: customerKeys.detail(uuid), queryFn: ({ signal }) => customersApi.detail(uuid, signal), enabled: needsGeneration, retry: false })
  const purchase = useQuery({ queryKey: purchaseKeys.detail(uuid, purchaseUuid), queryFn: ({ signal }) => purchasesApi.detail(uuid, purchaseUuid, signal), enabled: needsGeneration, retry: false })
  const generate = useMutation({ mutationFn: () => invoicesApi.generate(uuid, purchaseUuid, submission.current), onSuccess: result => { client.setQueryData(invoiceKeys.purchase(uuid, purchaseUuid), result) }, onError: error => { if (incompleteInvoice(error)) submission.current = crypto.randomUUID() } })
  const back = <Link to={`/customers/${uuid}/purchases/${purchaseUuid}`} className="text-sm font-medium text-ink underline underline-offset-4">Back to purchase</Link>
  if (invoice.isPending) return <LoadingState label="Loading invoice…" />
  if (invoice.isError) return <div className="space-y-5">{back}<ErrorState title="Invoice could not be loaded" description={invoiceErrorMessage(invoice.error)} onRetry={() => void invoice.refetch()} /></div>
  if (needsGeneration && (customer.isPending || purchase.isPending)) return <LoadingState label="Loading invoice purchase context…" />
  if (needsGeneration && (customer.isError || purchase.isError)) return <div className="space-y-5">{back}<ErrorState title="Invoice context could not be loaded" description={invoiceErrorMessage(customer.error ?? purchase.error)} onRetry={() => { void customer.refetch(); void purchase.refetch() }} /></div>
  if (needsGeneration && (customer.data?.archived_at || ['void', 'refunded'].includes(purchase.data?.status ?? ''))) return <div className="space-y-5">{back}<PageHeader eyebrow="Invoice" title="Invoice cannot be generated" description={customer.data?.archived_at ? 'Restore this customer before generating an invoice.' : 'This historical purchase cannot receive a new invoice.'} /></div>
  if (!invoice.data) return <div className="space-y-7">{back}<PageHeader eyebrow="Invoice" title="Generate invoice" description="Issue a permanent document from this saved sale." /><section className="space-y-5 border-y border-line py-5"><h2 className="text-[19px] font-semibold">Ready to issue</h2><p className="text-sm leading-6 text-muted">The invoice will preserve the shop details, items, totals, and payment position at issue.</p><Link to="/settings" className="block text-sm text-accent underline-offset-4 hover:underline">Review shop information</Link>{generate.isError ? <p className="text-sm text-accent" role="alert">{invoiceErrorMessage(generate.error)}</p> : null}<Button loading={generate.isPending} onClick={() => { if (lock.current) return; lock.current = true; generate.mutate(undefined, { onSettled: () => { lock.current = false } }) }}>{incompleteInvoice(generate.error) ? 'Generate with a new number' : 'Generate invoice'}</Button></section></div>
  return <div className="invoice-page space-y-6">
    <div className="invoice-screen-controls space-y-5">{back}<PageHeader eyebrow="Permanent invoice" title="View invoice" description="Reprints preserve the invoice as issued, including its payment position at that time." actions={<Button onClick={() => { void document.fonts.ready.then(() => window.print()) }}>Print invoice</Button>} /></div>
    <InvoiceDocument invoice={invoice.data} />
  </div>
}
function InvoiceDocument({ invoice }: { invoice: Invoice }) {
  const { shop, customer, purchase, items, payment_summary: payment, payment_methods: methods } = invoice.snapshot
  return <article className="invoice-document" aria-label={`Invoice ${invoice.invoice_number}`}>
    <header className="invoice-document-header"><div><h1>{shop.shop_name}</h1><p className="invoice-address">{shop.address}</p><p>Contact: {shop.contact_number}</p>{shop.gstin ? <p>GSTIN: {shop.gstin}</p> : null}</div><div className="invoice-heading"><h2>Invoice</h2><p className="invoice-number" data-testid="invoice-number">{invoice.invoice_number}</p><p>Issued: <time dateTime={invoice.issued_at}>{prescriptionDate(invoice.issued_at.slice(0, 10))} (UTC)</time></p><p>Purchase: <time dateTime={purchase.purchase_date}>{prescriptionDate(purchase.purchase_date)}</time></p></div></header>
    <section className="invoice-customer" aria-labelledby="invoice-customer-title"><h3 id="invoice-customer-title">Bill to</h3><p className="invoice-customer-name">{customer.name}</p><p>{customer.phone}</p>{purchase.prescription_uuid ? <p className="invoice-reference">Prescription reference: {purchase.prescription_uuid}</p> : null}</section>
    <table className="invoice-items"><caption>Purchase items · INR</caption><colgroup><col className="invoice-description-col" /><col className="invoice-quantity-col" /><col /><col /><col /></colgroup><thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Unit price</th><th scope="col">Discount</th><th scope="col">Line total</th></tr></thead><tbody>{items.map((item, index) => <tr key={item.uuid}>
      <td data-label="Item"><strong>{index + 1}. {item.description}</strong><span className="invoice-item-detail">{categoryLabel(item.product_category)}</span>{item.hsn_sac_code ? <span className="invoice-item-detail">HSN/SAC: {item.hsn_sac_code}</span> : null}{item.tax_paise ? <span className="invoice-item-detail">Recorded tax: {purchaseMoney(item.tax_paise)}{item.tax_rate_basis_points ? ` · ${formatPaise(asPaise(item.tax_rate_basis_points))}%` : ''}</span> : null}</td>
      <td data-label="Qty">{item.quantity}</td><td data-label="Unit price">{purchaseMoney(item.unit_price_paise)}</td><td data-label="Discount">{purchaseMoney(item.discount_paise)}</td><td data-label="Line total">{purchaseMoney(item.line_total_paise)}</td>
    </tr>)}</tbody></table>
    <section className="invoice-settlement" aria-label="Invoice totals and payment position"><div className="invoice-payment-methods"><h3>Payment position at issue</h3><p className="invoice-payment-status">{paymentStatusLabels[payment.payment_status]}</p>{methods.length ? <ul>{methods.map(method => <li key={method.payment_method}><span>{paymentMethodLabels[method.payment_method as PaymentMethod] ?? method.payment_method}</span><span>{purchaseMoney(method.amount_paise)}</span></li>)}</ul> : <p>No payments received at issue.</p>}<p className="invoice-small">As of <time dateTime={invoice.issued_at}>{new Date(invoice.issued_at).toLocaleString('en-IN', { timeZone: 'UTC' })} UTC</time>.</p></div>
      <dl className="invoice-totals"><div><dt>Subtotal</dt><dd>{purchaseMoney(purchase.subtotal_paise)}</dd></div><div><dt>Discount (all items and purchase)</dt><dd>{purchaseMoney(purchase.discount_paise)}</dd></div>{purchase.tax_paise ? <><div><dt>Recorded tax</dt><dd>{purchaseMoney(purchase.tax_paise)}</dd></div>{[['CGST', purchase.cgst_paise], ['SGST', purchase.sgst_paise], ['IGST', purchase.igst_paise]].map(([label, value]) => Number(value) > 0 ? <div key={label}><dt>{label}</dt><dd>{purchaseMoney(Number(value))}</dd></div> : null)}</> : null}<div className="invoice-grand-total"><dt>Purchase total</dt><dd data-testid="invoice-total">{purchaseMoney(purchase.total_paise)}</dd></div><div><dt>Total paid at issue</dt><dd data-testid="invoice-paid">{purchaseMoney(payment.amount_paid_paise)}</dd></div><div className="invoice-balance"><dt>{payment.outstanding_paise ? 'Balance due at issue' : 'Balance due — paid'}</dt><dd data-testid="invoice-balance">{purchaseMoney(payment.outstanding_paise)}</dd></div></dl>
    </section>
    <footer className="invoice-document-footer">{shop.footer_text ? <p>{shop.footer_text}</p> : null}{!purchase.tax_paise ? <p>No tax recorded for this purchase.</p> : null}<p>Payment amounts and balance reflect the issue time. Later payments appear in purchase history.</p><p className="invoice-reference">Purchase reference: {purchase.uuid}</p></footer>
  </article>
}
