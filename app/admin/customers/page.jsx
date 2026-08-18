'use client';

import { useState, useEffect } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Search, Plus, Edit, Trash2, Phone, Mail, Eye } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import FieldError, { inputErrorClass } from '@/components/ui/field-error';
import {
  digitsOnly,
  numbersOnlyInput,
  validateName,
  validatePhone,
  validateEmail,
  validatePositiveNumber,
  firstError,
} from '@/lib/form-validation';

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
  credit_limit: '',
  is_vip: false,
  is_blacklisted: false,
  notes: '',
};

const panelCustomerPath = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/cashier')
  ? '/cashier/customers'
  : '/admin/customers';

export default function AdminCustomers() {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const router = useRouter();
  const isCashier = usePathname()?.startsWith('/cashier');
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch('/api/admin/customers', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers || []);
      } else {
        const data = await response.json().catch(() => ({}));
        addToast(friendlyFromError(data, 'load_failed'));
      }
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  };

  const validateForm = (data = formData) => {
    const next = {
      name: validateName(data.name, 'customer name'),
      phone: validatePhone(data.phone, { required: true }),
      email: validateEmail(data.email, { required: false }),
      credit_limit: validatePositiveNumber(data.credit_limit === '' ? 0 : data.credit_limit, 'credit limit', {
        allowZero: true,
        required: false,
      }),
    };
    setErrors(next);
    return next;
  };

  const setField = (field, value) => {
    const next = { ...formData, [field]: value };
    setFormData(next);
    if (touched[field] || errors[field]) {
      setErrors((prev) => ({
        ...prev,
        [field]:
          field === 'name'
            ? validateName(value, 'customer name')
            : field === 'phone'
              ? validatePhone(value, { required: true })
              : field === 'email'
                ? validateEmail(value, { required: false })
                : field === 'credit_limit'
                  ? validatePositiveNumber(value === '' ? 0 : value, 'credit limit', {
                      allowZero: true,
                      required: false,
                    })
                  : null,
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched({ name: true, phone: true, email: true, credit_limit: true });
    const nextErrors = validateForm();
    const msg = firstError(nextErrors);
    if (msg) {
      addToast(friendlyMessage('validation', { description: msg }));
      return;
    }

    setSaving(true);
    try {
      const token = localStorage.getItem('pos_token');
      const body = editingCustomer
        ? {
            id: editingCustomer.id,
            name: formData.name.trim(),
            phone: digitsOnly(formData.phone),
            email: formData.email.trim() || null,
            address: formData.address.trim() || null,
            credit_limit: Number(formData.credit_limit) || 0,
            is_vip: !!formData.is_vip,
            is_blacklisted: !!formData.is_blacklisted,
            notes: formData.notes?.trim() || null,
          }
        : {
            name: formData.name.trim(),
            phone: digitsOnly(formData.phone),
            email: formData.email.trim() || null,
            address: formData.address.trim() || null,
            credit_limit: Number(formData.credit_limit) || 0,
            is_vip: !!formData.is_vip,
            is_blacklisted: !!formData.is_blacklisted,
            notes: formData.notes?.trim() || null,
          };

      const response = await fetch('/api/admin/customers', {
        method: editingCustomer ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        addToast(
          friendlyMessage('save_success', {
            description: editingCustomer ? 'Customer details were updated.' : 'Customer was added.',
          })
        );
        fetchCustomers();
        closeModal();
      } else {
        if (data.fields) setErrors((prev) => ({ ...prev, ...data.fields }));
        if (data.code === 'duplicate_phone') {
          setErrors((prev) => ({
            ...prev,
            phone: 'This phone number is already used by another customer.',
          }));
        }
        addToast(friendlyFromError(data, 'save_failed'));
      }
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingCustomer(null);
    setFormData(emptyForm);
    setErrors({});
    setTouched({});
  };

  const handleEdit = (customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      credit_limit: customer.credit_limit ?? '',
      is_vip: !!customer.is_vip,
      is_blacklisted: !!customer.is_blacklisted,
      notes: customer.notes || '',
    });
    setErrors({});
    setTouched({});
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Remove customer?',
      message: 'Remove this customer from your list?',
      tone: 'delete',
    });
    if (!ok) return;

    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch(`/api/admin/customers?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        addToast(friendlyMessage('delete_success', { description: 'Customer was removed.' }));
        fetchCustomers();
      } else {
        addToast(friendlyFromError(data, 'delete_failed'));
      }
    } catch (error) {
      addToast(friendlyFromError(error, 'delete_failed'));
    }
  };

  const filteredCustomers = customers.filter(
    (customer) =>
      customer.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.phone?.includes(searchTerm) ||
      customer.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <AdminLayout>
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Customers</h1>
            <p className="text-gray-700 mt-1 text-sm sm:text-base">Manage customer information</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingCustomer(null);
              setFormData(emptyForm);
              setErrors({});
              setTouched({});
              setShowModal(true);
            }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors w-full sm:w-auto"
          >
            <Plus className="w-5 h-5" />
            Add Customer
          </button>
        </div>
      </header>

      <div className="p-4 sm:p-6 lg:p-8">
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-700 w-5 h-5" />
            <input
              type="text"
              placeholder="Search customers by name, phone, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-700 text-gray-900"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading ? (
            <div className="col-span-full text-center py-12 text-gray-800">Loading customers...</div>
          ) : filteredCustomers.length === 0 ? (
            <div className="col-span-full text-center py-12 text-gray-800">No customers found</div>
          ) : (
            filteredCustomers.map((customer) => (
              <div
                key={customer.id}
                className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <button type="button" onClick={() => router.push(`${panelCustomerPath()}/${customer.id}`)} className="text-left">
                    <h3 className="text-lg font-semibold text-gray-900 hover:text-blue-700">{customer.name}</h3>
                    <p className="text-sm text-gray-700">ID: {customer.id}</p>
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => router.push(`${panelCustomerPath()}/${customer.id}`)}
                      className="p-2 text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
                      title="View profile"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEdit(customer)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    {!isCashier && (
                      <button
                        type="button"
                        onClick={() => handleDelete(customer.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  {customer.phone && (
                    <div className="flex items-center gap-2 text-sm text-gray-800">
                      <Phone className="w-4 h-4" />
                      <span>{customer.phone}</span>
                    </div>
                  )}
                  {customer.email && (
                    <div className="flex items-center gap-2 text-sm text-gray-800">
                      <Mail className="w-4 h-4" />
                      <span>{customer.email}</span>
                    </div>
                  )}
                  {customer.address && <p className="text-sm text-gray-800 mt-2">{customer.address}</p>}
                </div>

                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-800">Credit Balance</span>
                    <span
                      className={`text-sm font-semibold ${
                        (customer.current_credit || customer.credit_balance || 0) > 0
                          ? 'text-red-600'
                          : 'text-green-600'
                      }`}
                    >
                      Rs {Math.abs(customer.current_credit || customer.credit_balance || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm text-gray-800">Credit Limit</span>
                    <span className="text-sm font-medium text-gray-900">
                      Rs {(customer.credit_limit || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[94dvh] overflow-y-auto p-6 sm:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              {editingCustomer ? 'Edit Customer' : 'Add New Customer'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="Customer full name"
                  className={inputErrorClass(
                    !!errors.name,
                    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900'
                  )}
                />
                <FieldError message={errors.name} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Phone number *</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={formData.phone}
                  onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                  onChange={(e) => setField('phone', digitsOnly(e.target.value))}
                  placeholder="98XXXXXXXX"
                  className={inputErrorClass(
                    !!errors.phone,
                    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900'
                  )}
                />
                <FieldError message={errors.phone} />
                <p className="mt-1 text-xs text-gray-500">Required — digits only, at least 10 numbers.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  onChange={(e) => setField('email', e.target.value)}
                  placeholder="name@email.com (optional)"
                  className={inputErrorClass(
                    !!errors.email,
                    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900'
                  )}
                />
                <FieldError message={errors.email} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Address</label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setField('address', e.target.value)}
                  rows={3}
                  placeholder="Area / street (optional)"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Credit Limit</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formData.credit_limit}
                  onBlur={() => setTouched((t) => ({ ...t, credit_limit: true }))}
                  onChange={(e) => setField('credit_limit', numbersOnlyInput(e.target.value, { allowDecimal: true }))}
                  placeholder="0"
                  className={inputErrorClass(
                    !!errors.credit_limit,
                    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900'
                  )}
                />
                <FieldError message={errors.credit_limit} />
                <div className="flex flex-wrap gap-4 text-sm pt-1">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!formData.is_vip}
                      onChange={(e) => setFormData((f) => ({ ...f, is_vip: e.target.checked }))}
                    />
                    VIP
                  </label>
                  <label className="inline-flex items-center gap-2 text-red-700">
                    <input
                      type="checkbox"
                      checked={!!formData.is_blacklisted}
                      onChange={(e) => setFormData((f) => ({ ...f, is_blacklisted: e.target.checked }))}
                    />
                    Blacklisted
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="w-full rounded-lg border border-stone-200 px-3 py-2"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving…' : editingCustomer ? 'Update Customer' : 'Add Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
