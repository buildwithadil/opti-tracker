import { useState } from 'react'
import type { Customer } from '../../shared/customers'
import { CustomerPicker } from '../components/CustomerPicker'
import { PrescriptionHistory } from '../components/PrescriptionHistory'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'

export function PrescriptionsPage() {
  const [customer,setCustomer]=useState<Customer|null>(null)
  return <div className="space-y-5"><PageHeader title="Prescriptions" description={customer ? customer.name : 'Find the customer to view or add an optical prescription.'} actions={customer ? <Button variant="secondary" onClick={()=>setCustomer(null)}>Change customer</Button> : undefined} />{customer ? <PrescriptionHistory key={customer.uuid} customer={customer} /> : <CustomerPicker onSelect={setCustomer} />}</div>
}
