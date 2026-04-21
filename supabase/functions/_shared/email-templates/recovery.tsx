/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import { styles } from './_brand.ts'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ confirmationUrl }: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your Keeper password</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.header}>
          <Text style={styles.monogram}>K</Text>
          <Text style={styles.brandName}>KEEPER</Text>
        </Section>
        <Section style={styles.body}>
          <Heading style={styles.h1}>Reset your password</Heading>
          <Text style={styles.text}>
            We received a request to reset your Keeper password. Click below
            to choose a new one.
          </Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              Reset Password
            </Button>
          </Section>
          <div style={styles.divider} />
          <Text style={styles.fineprint}>
            This link expires in 24 hours. If you didn't request a reset, you
            can safely ignore this email — your password won't change.
          </Text>
        </Section>
        <Section style={styles.footer}>
          <Text style={styles.footerText}>Keeper · Budgeting together.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail
