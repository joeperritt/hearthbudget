/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import { styles } from './_brand.ts'

interface EmailChangeEmailProps {
  siteName: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  email,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your new Keeper email address</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.header}>
          <Text style={styles.monogram}>K</Text>
          <Text style={styles.brandName}>KEEPER</Text>
        </Section>
        <Section style={styles.body}>
          <Heading style={styles.h1}>Confirm your email change</Heading>
          <Text style={styles.text}>
            You requested to change your Keeper email from{' '}
            <Link href={`mailto:${email}`} style={styles.link}>
              {email}
            </Link>{' '}
            to{' '}
            <Link href={`mailto:${newEmail}`} style={styles.link}>
              {newEmail}
            </Link>
            .
          </Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              Confirm Change
            </Button>
          </Section>
          <div style={styles.divider} />
          <Text style={styles.fineprint}>
            This link expires in 24 hours. If you didn't request this change,
            please secure your account immediately.
          </Text>
        </Section>
        <Section style={styles.footer}>
          <Text style={styles.footerText}>Keeper · Budgeting together.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail
